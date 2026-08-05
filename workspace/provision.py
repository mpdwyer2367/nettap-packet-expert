#!/usr/bin/env python3
"""Provision versioned Packet Expert knowledge, Skills, and workspace model."""
import argparse, hashlib, json, os, sqlite3, sys, time
from pathlib import Path
import requests
from open_webui.utils.auth import create_token

API=os.getenv("OPEN_WEBUI_INTERNAL_URL","http://open-webui:8080").rstrip("/")
DB=Path(os.getenv("OPEN_WEBUI_DATABASE","/app/backend/data/webui.db"))
KNOWLEDGE_DIR=Path(os.getenv("KNOWLEDGE_DIR","/knowledge"))
SKILLS_DIR=Path(os.getenv("SKILLS_DIR","/workspace/skills"))
MODEL_ID=os.getenv("WORKSPACE_MODEL_ID","nettap-packet-expert")
BASE_MODEL=os.getenv("MODEL_NAME","nettap-packet-expert:0.1.0-rc.7")

def load(path): return json.loads(path.read_text(encoding="utf-8"))
KB_MANIFEST=load(KNOWLEDGE_DIR/"manifest.json")
SKILL_MANIFEST=load(SKILLS_DIR/"manifest.json")

def items(value):
    if isinstance(value,list): return value
    if isinstance(value,dict): return value.get("items") or value.get("knowledge_bases") or []
    return []

def wait_admin(timeout):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        try:
            with sqlite3.connect(DB) as db:
                row=db.execute("select id from user where role='admin' order by created_at limit 1").fetchone()
            if row: return str(row[0])
        except sqlite3.Error: pass
        print("Waiting for the first Open WebUI administrator account...",flush=True); time.sleep(5)
    raise TimeoutError("No administrator account appeared before the timeout")

class Client:
    def __init__(self,user):
        self.session=requests.Session()
        self.session.headers["Authorization"]=f"Bearer {create_token({'id':user})}"
    def call(self,method,path,**kwargs):
        response=self.session.request(method,API+path,timeout=300,**kwargs)
        if response.status_code!=200:
            raise RuntimeError(f"{method} {path}: {response.status_code} {response.text[:800]}")
        return response.json() if response.content else None

def knowledge_files(client,kb_id):
    return items(client.call("GET",f"/api/v1/knowledge/{kb_id}/files?limit=100"))

def sync_knowledge(client):
    name=KB_MANIFEST["name"]
    kb=next((x for x in items(client.call("GET","/api/v1/knowledge/")) if x.get("name")==name),None)
    if not kb:
        kb=client.call("POST","/api/v1/knowledge/create",json={"name":name,"description":KB_MANIFEST["description"],"access_grants":[]})
    existing=knowledge_files(client,kb["id"])
    managed=set(KB_MANIFEST["files"])
    for filename in KB_MANIFEST["files"]:
        path=KNOWLEDGE_DIR/filename; digest=hashlib.sha256(path.read_bytes()).hexdigest()
        current=next((f for f in existing if f and f.get("filename")==filename and f.get("hash")==digest),None)
        if current: continue
        for old in [f for f in existing if f and f.get("filename")==filename]:
            client.call("POST",f"/api/v1/knowledge/{kb['id']}/file/remove?delete_file=true",json={"file_id":old["id"]})
        with path.open("rb") as stream:
            client.call("POST","/api/v1/files/?process=true&process_in_background=false",files={"file":(filename,stream,"text/markdown")},data={"metadata":json.dumps({"knowledge_id":kb["id"],"file_hash":digest,"managed_by":"nettap-packet-expert"})})
    kb=client.call("GET",f"/api/v1/knowledge/{kb['id']}")
    kb["files"]=[f for f in knowledge_files(client,kb["id"]) if f and f.get("filename") in managed]
    return kb

def sync_skills(client):
    ids=[]
    for definition in SKILL_MANIFEST["skills"]:
        skill_id=definition["id"]; ids.append(skill_id)
        form={"id":skill_id,"name":definition["name"],"description":definition["description"],"content":(SKILLS_DIR/definition["file"]).read_text(encoding="utf-8"),"meta":{"tags":definition["tags"]},"is_active":True,"access_grants":[]}
        exists=client.session.get(f"{API}/api/v1/skills/id/{skill_id}",timeout=60).status_code==200
        client.call("POST",f"/api/v1/skills/id/{skill_id}/update" if exists else "/api/v1/skills/create",json=form)
    return ids

def sync_model(client,kb,skill_ids):
    form={"id":MODEL_ID,"base_model_id":BASE_MODEL,"name":"NetTAP Packet Expert","params":{},"meta":{"description":"Packet acquisition, protocol analysis, TCP/application performance, security, and forensic specialist.","capabilities":{"file_upload":True,"file_context":True,"web_search":False,"image_generation":False,"code_interpreter":False,"terminal":False,"citations":True,"status_updates":True,"builtin_tools":True},"builtinTools":{"knowledge":True},"skillIds":skill_ids,"knowledge":[{"id":kb["id"],"name":kb["name"],"type":"collection"}],"tags":[{"name":"NetTAP"},{"name":"Packet Evidence"},{"name":"Forensics"}]},"access_grants":[],"is_active":True}
    models=items(client.call("GET","/api/v1/models/list?query=NetTAP%20Packet%20Expert&limit=100"))
    client.call("POST","/api/v1/models/model/update" if any(x.get("id")==MODEL_ID for x in models) else "/api/v1/models/create",json=form)

def validate(client,kb):
    names={f.get("filename") for f in kb.get("files",[])}
    missing=set(KB_MANIFEST["files"])-names
    if missing: raise AssertionError(f"Missing indexed knowledge files: {sorted(missing)}")
    for case in KB_MANIFEST["retrieval_cases"]:
        result=client.call("POST","/api/v1/retrieval/query/collection",json={"collection_names":[kb["id"]],"query":case["query"],"k":5})
        text=json.dumps(result).lower()
        if not any(marker.lower() in text for marker in case["markers"]):
            raise AssertionError(f"Retrieval case failed: {case['query']}")
    model=next((x for x in items(client.call("GET","/api/v1/models/list?query=NetTAP%20Packet%20Expert&limit=100")) if x.get("id")==MODEL_ID),None)
    expected={x["id"] for x in SKILL_MANIFEST["skills"]}
    if not model or set((model.get("meta") or {}).get("skillIds",[]))!=expected: raise AssertionError("Skill attachments do not match the manifest")
    if kb["id"] not in [x.get("id") for x in (model.get("meta") or {}).get("knowledge",[])]: raise AssertionError("Knowledge is not attached")
    print(f"PASS: {len(names)} knowledge files, {len(expected)} Skills, {len(KB_MANIFEST['retrieval_cases'])} retrieval cases, and model attachments validated.")

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--validate-only",action="store_true"); parser.add_argument("--wait-timeout",type=int,default=int(os.getenv("WORKSPACE_INIT_WAIT_SECONDS","604800"))); args=parser.parse_args()
    client=Client(wait_admin(args.wait_timeout))
    matches=[x for x in items(client.call("GET","/api/v1/knowledge/")) if x.get("name")==KB_MANIFEST["name"]]
    if args.validate_only:
        if not matches: raise AssertionError("Knowledge base is not installed")
        kb=client.call("GET",f"/api/v1/knowledge/{matches[0]['id']}"); kb["files"]=knowledge_files(client,kb["id"])
    else:
        kb=sync_knowledge(client); skill_ids=sync_skills(client); sync_model(client,kb,skill_ids)
    validate(client,kb)

if __name__=="__main__":
    try: main()
    except Exception as error: print(f"ERROR: {error}",file=sys.stderr); raise
