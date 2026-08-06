"use strict";

const state = { token: "", cases: [], activeCase: null, configuration: null };
const $ = (selector) => document.querySelector(selector);
const BASE_PATH = window.location.pathname.startsWith("/evidence") ? "/evidence" : "";

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${state.token}`);
  const response = await fetch(`${BASE_PATH}${path}`, { ...options, headers });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body.error || body || `Request failed: ${response.status}`);
  return body;
}

function message(text, type = "") {
  const element = $("#message");
  element.textContent = text;
  element.className = type;
}

async function connect() {
  state.token = $("#token").value.trim();
  if (!state.token) return message("Enter the generated evidence API token.", "error");
  try {
    await Promise.all([loadCases(), loadConfiguration()]);
    message("Connected to the local evidence workspace.", "success");
  } catch (error) {
    state.token = "";
    message(error.message, "error");
  }
}

function selectView(viewId) {
  document.querySelectorAll(".view").forEach((view) => {
    const selected = view.id === viewId;
    view.hidden = !selected;
    view.classList.toggle("active", selected);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MiB`;
  return `${Math.round(value / 1024)} KiB`;
}

async function loadConfiguration() {
  const configuration = await api("/v1/configuration");
  state.configuration = configuration;
  const integration = configuration.assistant_integration;
  $("#config-integration").textContent = "Managed and provisioned";
  $("#config-webui-url").textContent = integration.open_webui_url;
  $("#config-packet-profile").textContent = integration.packet_expert_profile;
  $("#config-tool-binding").textContent = integration.tool_binding;
  $("#config-upload-limit").textContent = formatBytes(configuration.max_upload_bytes);
  $("#config-record-limit").textContent = configuration.max_records_per_source.toLocaleString();
  renderSourceCatalog(configuration.source_types);
  updateSourceGuidance();
}

function renderSourceCatalog(sources) {
  const catalog = $("#source-catalog");
  catalog.replaceChildren();
  for (const source of sources) {
    const card = document.createElement("article");
    card.className = "source-card";
    const heading = document.createElement("strong");
    heading.textContent = source.label;
    const accepted = document.createElement("span");
    accepted.textContent = source.accepted;
    const parser = document.createElement("small");
    parser.textContent = `${source.parser}. ${source.limitations}`;
    card.append(heading, accepted, parser);
    catalog.append(card);
  }
}

function updateSourceGuidance() {
  const sourceType = $("#source-type").value;
  const source = state.configuration?.source_types.find((item) => item.id === sourceType);
  $("#source-guidance").textContent = source
    ? `${source.accepted}. ${source.limitations}.`
    : "The file must match the selected supported parser and schema.";
  const file = $("#evidence-file");
  if (sourceType === "pcap") file.accept = ".pcap,application/vnd.tcpdump.pcap";
  else if (sourceType === "syslog") file.accept = ".log,.txt,text/plain";
  else file.accept = ".json,.jsonl,application/json,text/plain";
}

async function loadCases() {
  const result = await api("/v1/cases");
  state.cases = result.cases;
  renderCases();
}

function renderCases() {
  const list = $("#case-list");
  list.replaceChildren();
  for (const item of state.cases) {
    const button = document.createElement("button");
    button.className = `case-item${state.activeCase?.id === item.id ? " active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = item.title;
    const details = document.createElement("span");
    details.textContent = `${item.evidence_count} sources · ${item.status}`;
    button.append(title, details);
    button.addEventListener("click", () => selectCase(item.id));
    list.append(button);
  }
}

async function selectCase(caseId) {
  try {
    state.activeCase = await api(`/v1/cases/${caseId}`);
    renderCases();
    renderActiveCase();
  } catch (error) { message(error.message, "error"); }
}

function renderActiveCase() {
  const item = state.activeCase;
  $("#empty-state").hidden = true;
  $("#case-content").hidden = false;
  $("#active-title").textContent = item.title;
  $("#active-objective").textContent = item.objective || "No objective supplied";
  $("#metric-sources").textContent = item.evidence.length;
  const summary = item.latest_analysis?.summary;
  $("#metric-records").textContent = summary?.observation_count ?? item.evidence.reduce((total, evidence) => total + evidence.record_count, 0);
  $("#metric-findings").textContent = "—";
  renderEvidence(item.evidence);
  renderSummary(summary);
  if (item.latest_analysis) renderFindings(item.findings || []);
  else $("#findings").innerHTML = "<p class='warning'>Run deterministic analysis to generate evidence-bound findings.</p>";
}

function renderEvidence(items) {
  const list = $("#evidence-list");
  list.replaceChildren();
  if (!items.length) { list.textContent = "No evidence has been uploaded."; return; }
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "evidence-card";
    const title = document.createElement("strong");
    title.textContent = item.original_filename;
    const details = document.createElement("span");
    details.textContent = `${item.source_type} · ${item.record_count} records · SHA-256 ${item.sha256.slice(0, 12)}…`;
    card.append(title, details);
    if (item.quality_warnings.length) {
      const warning = document.createElement("span");
      warning.className = "warning";
      warning.textContent = `${item.quality_warnings.length} evidence-quality limitation(s)`;
      card.append(warning);
    }
    list.append(card);
  }
}

function renderSummary(summary) {
  if (!summary) { $("#summary").textContent = "Analysis has not been run."; return; }
  const protocols = summary.protocols.slice(0, 5).map((item) => `${item.value}: ${item.records}`).join(" · ");
  $("#summary").textContent = `${summary.observation_count} normalized observations. ${protocols || "No protocols identified."}`;
}

function renderFindings(findings) {
  const list = $("#findings");
  list.replaceChildren();
  $("#metric-findings").textContent = findings.length;
  if (!findings.length) { list.textContent = "No deterministic findings were produced."; return; }
  for (const item of findings) {
    const card = document.createElement("article");
    card.className = "finding-card";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const badges = document.createElement("div");
    for (const value of [item.classification, `${item.confidence} confidence`]) {
      const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = value; badges.append(badge);
    }
    const statement = document.createElement("p"); statement.textContent = item.statement;
    card.append(title, badges, statement);
    list.append(card);
  }
}

async function createCase(event) {
  event.preventDefault();
  try {
    const created = await api("/v1/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: $("#case-title").value, objective: $("#case-objective").value, environment: $("#case-environment").value })
    });
    event.target.reset();
    await loadCases();
    await selectCase(created.id);
    message("Case created.", "success");
  } catch (error) { message(error.message, "error"); }
}

function metadataHeader(metadata) {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function uploadEvidence(event) {
  event.preventDefault();
  if (!state.activeCase) return;
  const file = $("#evidence-file").files[0];
  if (!file) return message("Choose an evidence file.", "error");
  const sourceType = $("#source-type").value;
  if (state.configuration && file.size > state.configuration.max_upload_bytes) {
    return message(`The selected file exceeds the ${formatBytes(state.configuration.max_upload_bytes)} appliance limit.`, "error");
  }
  const lowerName = file.name.toLowerCase();
  if (sourceType === "pcap" && !lowerName.endsWith(".pcap")) {
    return message("Classic PCAP ingestion requires a .pcap file. PCAPNG is not supported by the built-in parser.", "error");
  }
  if (["normalized-pcap", "ipfix", "netflow", "sflow", "cloud-flow", "jsonl"].includes(sourceType)
      && ![".json", ".jsonl"].some((extension) => lowerName.endsWith(extension))) {
    return message("This source requires normalized UTF-8 JSON or JSONL, not a native binary export.", "error");
  }
  const metadata = {
    observation_point: $("#observation-point").value || "unknown",
    source_timezone: $("#timezone").value || "unknown",
    exporter_identity: $("#exporter").value || "unknown",
    schema_version: $("#schema-version").value || "unknown",
    clock_sync_status: $("#clock-status").value,
    chain_of_custody: $("#chain").value || "unknown",
    sampling_rate: $("#sampling-rate").value || "unknown",
    capture_drops: $("#capture-drops").value || "unknown",
    truncation: $("#truncation").value,
    ipfix_template_status: $("#template-status").value,
    direction: $("#direction").value || "unknown",
    interface: $("#interface").value || "unknown",
    acquisition_method: "browser-upload"
  };
  const params = new URLSearchParams({ source_type: sourceType, filename: file.name });
  try {
    message("Uploading and normalizing evidence…");
    await api(`/v1/cases/${state.activeCase.id}/evidence?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-NetTAP-Metadata": metadataHeader(metadata) },
      body: file
    });
    event.target.reset();
    $("#timezone").value = "UTC";
    updateSourceGuidance();
    await loadCases();
    await selectCase(state.activeCase.id);
    message("Evidence passed parser validation, was hashed, retained locally and normalized. Review its quality limitations before analysis.", "success");
  } catch (error) { message(error.message, "error"); }
}

async function runAnalysis() {
  if (!state.activeCase) return;
  try {
    const result = await api(`/v1/cases/${state.activeCase.id}/analyze`, { method: "POST" });
    state.activeCase = await api(`/v1/cases/${state.activeCase.id}`);
    renderActiveCase();
    renderFindings(result.findings);
    renderSummary(result.latest_analysis.summary);
    message("Deterministic analysis completed. No LLM inference was used.", "success");
  } catch (error) { message(error.message, "error"); }
}

async function showOutput(kind) {
  if (!state.activeCase) return;
  try {
    const suffix = kind === "report" ? "report.md" : "context";
    const content = await api(`/v1/cases/${state.activeCase.id}/${suffix}`);
    $("#dialog-title").textContent = kind === "report" ? "Markdown case report" : "LLM-safe evidence context";
    $("#dialog-content").textContent = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    $("#output-dialog").showModal();
  } catch (error) { message(error.message, "error"); }
}

async function copyContext() {
  if (!state.activeCase) return;
  try {
    const content = await api(`/v1/cases/${state.activeCase.id}/context`);
    await navigator.clipboard.writeText(JSON.stringify(content, null, 2));
    message("Minimized context copied for offline review. Normal Packet Expert handoff retrieves it through the managed case tool.", "success");
  } catch (error) { message(error.message, "error"); }
}

function packetExpertUrl(caseId = "") {
  if (!state.configuration) throw new Error("Connect to the Evidence Workspace first.");
  const integration = state.configuration.assistant_integration;
  const prompt = caseId
    ? `Analyze NetTAP Evidence Workspace case ${caseId}. Use the managed read-only evidence tool to retrieve the minimized case context. Produce a professional evidence-bound assessment and cite evidence IDs. Do not claim live telemetry or confirmed compromise unless the case supports it.`
    : "Open Packet Expert and explain how to create, validate and analyze a NetTAP Evidence Workspace case.";
  const parameters = new URLSearchParams({ model: integration.packet_expert_profile, q: prompt });
  return `${integration.open_webui_url}/?${parameters}`;
}

function openPacketExpert() {
  if (!state.activeCase) return message("Select a case before opening Packet Expert.", "error");
  if (!state.activeCase.latest_analysis) return message("Run deterministic analysis before assistant handoff.", "error");
  try {
    window.open(packetExpertUrl(state.activeCase.id), "_blank", "noopener,noreferrer");
    message("Packet Expert opened with this case ID. The assistant retrieves only minimized context through the managed read-only tool.", "success");
  } catch (error) { message(error.message, "error"); }
}

async function copyCaseId() {
  if (!state.activeCase) return;
  try {
    await navigator.clipboard.writeText(state.activeCase.id);
    message("Case ID copied for an authorized Packet Expert conversation.", "success");
  } catch (error) { message(error.message, "error"); }
}

function testHandoff() {
  try {
    window.open(packetExpertUrl(), "_blank", "noopener,noreferrer");
  } catch (error) { message(error.message, "error"); }
}

async function health() {
  try {
    const response = await fetch(`${BASE_PATH}/health`);
    const result = await response.json();
    $("#health").textContent = `Service ${result.version}`;
    $("#health-dot").classList.add("healthy");
  } catch { $("#health").textContent = "Service unavailable"; }
}

$("#connect").addEventListener("click", connect);
$("#refresh-cases").addEventListener("click", () => loadCases().catch((error) => message(error.message, "error")));
$("#case-form").addEventListener("submit", createCase);
$("#upload-form").addEventListener("submit", uploadEvidence);
$("#analyze").addEventListener("click", runAnalysis);
$("#report").addEventListener("click", () => showOutput("report"));
$("#context").addEventListener("click", () => showOutput("context"));
$("#copy-context").addEventListener("click", copyContext);
$("#copy-case-id").addEventListener("click", copyCaseId);
$("#open-packet-expert").addEventListener("click", openPacketExpert);
$("#test-handoff").addEventListener("click", testHandoff);
$("#source-type").addEventListener("change", updateSourceGuidance);
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => selectView(button.dataset.view)));
$("#close-dialog").addEventListener("click", () => $("#output-dialog").close());
updateSourceGuidance();
health();
