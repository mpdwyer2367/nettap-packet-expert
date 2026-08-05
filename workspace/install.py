#!/usr/bin/env python3
"""Idempotently provision Packet Expert knowledge, Skill, and workspace model."""
import argparse, hashlib, json, os, sqlite3, sys, time
from pathlib import Path
import requests
from open_webui.utils.auth import create_token

API=os.getenv("OPEN_WEBUI_INTERNAL_URL","http://open-webui:8080").rstrip("/")
DB=Path(os.getenv("OPEN_WEBUI_DATABASE","/app/backend/data/webui.db"))
KB_FILE=Path(os.getenv("KNOWLEDGE_PATH","/knowledge/NetTAP_Packet_Expert_Knowledge.md"))
SKILL_FILE=Path(os.getenv("SKILL_PATH","/workspace/skills/nettap-packet-evidence-analysis.md"))
MODEL_ID=os.getenv("WORKSPACE_MODEL_ID","nettap-packet-expert")
BASE_MODEL=os.getenv("MODEL_NAME","nettap-packet-expert:0.1.0-rc.7")
KB_NAME="NetTAP Packet Expert"
SKILL_ID="nettap-packet-evidence-analysis"

def list_items(value):
    if isinstance(value,list): return value
    if isinstance(value,dict): return value.get("items") or value.get("knowledge_bases") or []
    return []

def wait_for_admin(timeout):
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
    def __init__(self,user_id):
        self.s=requests.Session(); self.s.headers["Authorization"]=f"Bearer {create_token({'id':user_id})}"
    def call(self,method,path,expected=(200,),**kwargs):
        r=self.s.request(method,API+path,timeout=300,**kwargs)
        if r.status_code not in expected: raise RuntimeError(f"{method} {path}: {r.status_code} {r.text[:800]}")
        return r.json() if r.content else None

def sync_knowledge(c):
    kb=next((x for x in list_items(c.call("GET","/api/v1/knowledge/")) if x.get("name")==KB_NAME),None)
    if not kb:
        kb=c.call("POST","/api/v1/knowledge/create",json={"name":KB_NAME,"description":"Versioned NetTAP packet evidence and forensic guidance.","access_grants":[]})
    digest=hashlib.sha256(KB_FILE.read_bytes()).hexdigest()
    files=list_items(c.call("GET",f"/api/v1/knowledge/{kb['id']}/files?limit=100"))
    current=next((f for f in files if f and f.get("filename")==KB_FILE.name and f.get("hash")==digest),None)
    if not current:
        for f in files:
            if f and f.get("filename")==KB_FILE.name:
                c.call("POST",f"/api/v1/knowledge/{kb['id']}/file/remove?delete_file=true",json={"file_id":f["id"]})
        with KB_FILE.open("rb") as stream:
            c.call("POST","/api/v1/files/?process=true&process_in_background=false",files={"file":(KB_FILE.name,stream,"text/markdown")},data={"metadata":json.dumps({"knowledge_id":kb["id"],"file_hash":digest})})
    kb=c.call("GET",f"/api/v1/knowledge/{kb['id']}")
    kb["files"]=list_items(c.call("GET",f"/api/v1/knowledge/{kb['id']}/files?limit=100"))
    return kb

def sync_skill(c):
    form={"id":SKILL_ID,"name":"NetTAP Packet Evidence Analysis","description":"Evidence-driven packet acquisition, performance, security, and forensic workflow.","content":SKILL_FILE.read_text(),"meta":{"tags":["nettap","packet-analysis","forensics"]},"is_active":True,"access_grants":[]}
    exists=c.s.get(f"{API}/api/v1/skills/id/{SKILL_ID}",timeout=60).status_code==200
    c.call("POST",f"/api/v1/skills/id/{SKILL_ID}/update" if exists else "/api/v1/skills/create",json=form)

def sync_model(c,kb):
    form={"id":MODEL_ID,"base_model_id":BASE_MODEL,"name":"NetTAP Packet Expert","params":{},"meta":{"description":"Packet acquisition, evidence analysis, performance, security, and forensic specialist.","capabilities":{"file_upload":True,"file_context":True,"web_search":False,"image_generation":False,"code_interpreter":False,"terminal":False,"citations":True,"status_updates":True,"builtin_tools":True},"builtinTools":{"knowledge":True},"skillIds":[SKILL_ID],"knowledge":[{"id":kb["id"],"name":kb["name"],"type":"collection"}],"tags":[{"name":"NetTAP"},{"name":"Packet Evidence"},{"name":"Forensics"}]},"access_grants":[],"is_active":True}
    models=list_items(c.call("GET","/api/v1/models/list?query=NetTAP%20Packet%20Expert&limit=100"))
    c.call("POST","/api/v1/models/model/update" if any(x.get("id")==MODEL_ID for x in models) else "/api/v1/models/create",json=form)

def validate(c,kb):
    if not any(f and f.get("filename")==KB_FILE.name for f in kb.get("files") or []): raise AssertionError("Knowledge file is not attached")
    result=c.call("POST","/api/v1/retrieval/query/collection",json={"collection_names":[kb["id"]],"query":"What must be validated before packet analysis when evidence quality may be poor?","k":4})
    text=json.dumps(result).lower()
    if not any(x in text for x in ("capture position","timestamp","dropped-packet","poor evidence")): raise AssertionError("Expected evidence-quality guidance was not retrieved")
    models=list_items(c.call("GET","/api/v1/models/list?query=NetTAP%20Packet%20Expert&limit=100"))
    model=next((x for x in models if x.get("id")==MODEL_ID),None)
    if not model: raise AssertionError("Workspace model is not installed")
    meta=model.get("meta") or {}
    if SKILL_ID not in meta.get("skillIds",[]): raise AssertionError("Formal Skill is not attached")
    if kb["id"] not in [x.get("id") for x in meta.get("knowledge",[])]: raise AssertionError("Knowledge is not attached to the model")
    print("PASS: knowledge indexing, retrieval, Skill, and model attachments validated.")

def main():
    p=argparse.ArgumentParser(); p.add_argument("--validate-only",action="store_true"); p.add_argument("--wait-timeout",type=int,default=int(os.getenv("WORKSPACE_INIT_WAIT_SECONDS","604800"))); a=p.parse_args()
    c=Client(wait_for_admin(a.wait_timeout))
    matches=[x for x in list_items(c.call("GET","/api/v1/knowledge/")) if x.get("name")==KB_NAME]
    if a.validate_only:
        if not matches: raise AssertionError("Packet Expert knowledge is not installed")
        kb=c.call("GET",f"/api/v1/knowledge/{matches[0]['id']}")
        kb["files"]=list_items(c.call("GET",f"/api/v1/knowledge/{kb['id']}/files?limit=100"))
    else:
        kb=sync_knowledge(c); sync_skill(c); sync_model(c,kb)
    validate(c,kb)

if __name__=="__main__":
    try: main()
    except Exception as error: print(f"ERROR: {error}",file=sys.stderr); raise
