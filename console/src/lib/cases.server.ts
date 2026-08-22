import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CaseDetail, CustodyEntry, EvidenceItem, ProposalItem } from "./case-types";

type Client = SupabaseClient<Database>;

function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort ? undefined : undefined);
}

/** Deterministic content hash for an evidence payload, used for chain-of-custody. */
export function computeContentHash(input: Record<string, unknown>): string {
  const sorted = JSON.stringify(sortKeysDeep(input));
  return createHash("sha256").update(sorted).digest("hex");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

export async function listCases(supabase: Client) {
  const { data, error } = await supabase.from("cases").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCaseDetail(supabase: Client, caseId: string): Promise<{
  caseRow: CaseDetail;
  events: unknown[];
  evidence: EvidenceItem[];
  proposals: ProposalItem[];
} | null> {
  const { data: caseRow, error } = await supabase.from("cases").select("*").eq("id", caseId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!caseRow) return null;

  const { data: events, error: eventsError } = await supabase
    .from("case_events")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (eventsError) throw new Error(eventsError.message);

  const { data: evidenceRows, error: evidenceError } = await supabase
    .from("case_evidence")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  if (evidenceError) throw new Error(evidenceError.message);

  const evidenceIds = (evidenceRows ?? []).map((row) => row.id);
  let custodyByEvidence = new Map<string, CustodyEntry[]>();
  if (evidenceIds.length > 0) {
    const { data: custodyRows, error: custodyError } = await supabase
      .from("case_custody")
      .select("*")
      .in("evidence_id", evidenceIds)
      .order("created_at", { ascending: true });
    if (custodyError) throw new Error(custodyError.message);
    custodyByEvidence = new Map();
    for (const row of custodyRows ?? []) {
      const list = custodyByEvidence.get(row.evidence_id) ?? [];
      list.push({ ...row, detail: (row.detail ?? {}) as Record<string, unknown> });
      custodyByEvidence.set(row.evidence_id, list);
    }
  }

  const evidence: EvidenceItem[] = (evidenceRows ?? []).map((row) => ({
    ...row,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    custody: custodyByEvidence.get(row.id) ?? [],
  }));

  const { data: proposalRows, error: proposalError } = await supabase
    .from("case_proposals")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  if (proposalError) throw new Error(proposalError.message);

  const proposals: ProposalItem[] = (proposalRows ?? []).map((row) => ({
    ...row,
    proposed_change: (row.proposed_change ?? {}) as Record<string, unknown>,
  }));

  return { caseRow, events: events ?? [], evidence, proposals };
}

export async function createCase(
  supabase: Client,
  userId: string,
  input: {
    title: string;
    summary?: string | null;
    severity?: string;
    status?: string;
    owner?: string | null;
    sites?: string[];
    devices?: string[];
    investigationId?: string | null;
    datasetId?: string | null;
  },
) {
  const { data, error } = await supabase
    .from("cases")
    .insert({
      user_id: userId,
      title: input.title.trim() || "Untitled case",
      summary: input.summary ?? null,
      severity: input.severity ?? "medium",
      status: input.status ?? "open",
      owner: input.owner ?? null,
      sites: input.sites ?? [],
      devices: input.devices ?? [],
      investigation_id: input.investigationId ?? null,
      dataset_id: input.datasetId ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create case");

  await appendCaseEvent(supabase, userId, {
    caseId: data.id,
    kind: "created",
    actor: userId,
    body: `Case opened: ${data.title}`,
  });

  return data;
}

export async function updateCase(
  supabase: Client,
  userId: string,
  input: {
    id: string;
    title?: string;
    summary?: string | null;
    severity?: string;
    status?: string;
    owner?: string | null;
    sites?: string[];
    devices?: string[];
  },
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title.trim() || "Untitled case";
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === "closed") patch.closed_at = new Date().toISOString();
  }
  if (input.owner !== undefined) patch.owner = input.owner;
  if (input.sites !== undefined) patch.sites = input.sites;
  if (input.devices !== undefined) patch.devices = input.devices;

  const { data, error } = await supabase
    .from("cases")
    .update(patch as never)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update case");

  const changed = Object.keys(patch).filter((k) => k !== "updated_at");
  await appendCaseEvent(supabase, userId, {
    caseId: input.id,
    kind: "updated",
    actor: userId,
    body: `Case updated (${changed.join(", ") || "no fields"})`,
    extra: { changed },
  });

  return data;
}

export async function appendCaseEvent(
  supabase: Client,
  userId: string,
  input: { caseId: string; kind: string; actor?: string | null; body: string; extra?: Record<string, unknown> },
) {
  const { data, error } = await supabase
    .from("case_events")
    .insert({
      user_id: userId,
      case_id: input.caseId,
      kind: input.kind,
      actor: input.actor ?? userId,
      body: input.body,
      extra: (input.extra ?? {}) as never,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to append case event");
  return data;
}

export async function addCaseEvidence(
  supabase: Client,
  userId: string,
  input: {
    caseId: string;
    label: string;
    evidenceKind: string;
    datasetId?: string | null;
    recordIds?: number[];
    documentId?: string | null;
    chunkId?: string | null;
    connectionId?: string | null;
    payload?: Record<string, unknown>;
    source?: string | null;
    vantage?: string | null;
    fidelityTier?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
  },
) {
  const payload = input.payload ?? {};
  const contentHash = computeContentHash({
    label: input.label,
    evidenceKind: input.evidenceKind,
    datasetId: input.datasetId ?? null,
    recordIds: input.recordIds ?? [],
    documentId: input.documentId ?? null,
    chunkId: input.chunkId ?? null,
    connectionId: input.connectionId ?? null,
    payload,
    source: input.source ?? null,
    vantage: input.vantage ?? null,
    fidelityTier: input.fidelityTier ?? null,
    windowStart: input.windowStart ?? null,
    windowEnd: input.windowEnd ?? null,
  });

  const { data, error } = await supabase
    .from("case_evidence")
    .insert({
      user_id: userId,
      case_id: input.caseId,
      label: input.label,
      evidence_kind: input.evidenceKind,
      dataset_id: input.datasetId ?? null,
      record_ids: input.recordIds ?? [],
      document_id: input.documentId ?? null,
      chunk_id: input.chunkId ?? null,
      connection_id: input.connectionId ?? null,
      payload: payload as never,
      source: input.source ?? null,
      vantage: input.vantage ?? null,
      fidelity_tier: input.fidelityTier ?? null,
      window_start: input.windowStart ?? null,
      window_end: input.windowEnd ?? null,
      content_hash: contentHash,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to add evidence");

  const { error: custodyError } = await supabase.from("case_custody").insert({
    user_id: userId,
    evidence_id: data.id,
    action: "collected",
    actor: userId,
    detail: { label: input.label, evidence_kind: input.evidenceKind, source: input.source ?? null } as never,
    content_hash: contentHash,
  });
  if (custodyError) throw new Error(custodyError.message);

  await appendCaseEvent(supabase, userId, {
    caseId: input.caseId,
    kind: "evidence_added",
    actor: userId,
    body: `Evidence attached: ${input.label}`,
    extra: { evidence_id: data.id, content_hash: contentHash },
  });

  return { ...data, payload: payload as Record<string, unknown>, contentHash };
}

export async function deleteCaseEvidence(supabase: Client, userId: string, evidenceId: string, caseId: string) {
  const { error } = await supabase.from("case_evidence").delete().eq("id", evidenceId);
  if (error) throw new Error(error.message);
  await appendCaseEvent(supabase, userId, {
    caseId,
    kind: "evidence_removed",
    actor: userId,
    body: "Evidence removed from case",
    extra: { evidence_id: evidenceId },
  });
}

export async function createProposal(
  supabase: Client,
  userId: string,
  input: {
    caseId: string;
    connectionId?: string | null;
    title: string;
    rationale: string;
    target?: string | null;
    changeKind?: string;
    proposedChange?: Record<string, unknown>;
    risk?: string;
  },
) {
  const { data, error } = await supabase
    .from("case_proposals")
    .insert({
      user_id: userId,
      case_id: input.caseId,
      connection_id: input.connectionId ?? null,
      title: input.title,
      rationale: input.rationale,
      target: input.target ?? null,
      change_kind: input.changeKind ?? "config",
      proposed_change: (input.proposedChange ?? {}) as never,
      risk: input.risk ?? "medium",
      status: "proposed",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create proposal");

  await appendCaseEvent(supabase, userId, {
    caseId: input.caseId,
    kind: "proposal_created",
    actor: userId,
    body: `Change proposed for human review: ${input.title}`,
    extra: { proposal_id: data.id, risk: data.risk },
  });

  return data;
}

export async function reviewProposal(
  supabase: Client,
  userId: string,
  input: { id: string; caseId: string; status: string; reviewerNote?: string | null },
) {
  const { data, error } = await supabase
    .from("case_proposals")
    .update({
      status: input.status,
      reviewer_note: input.reviewerNote ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to review proposal");

  await appendCaseEvent(supabase, userId, {
    caseId: input.caseId,
    kind: "proposal_reviewed",
    actor: userId,
    body: `Proposal "${data.title}" marked ${input.status} (never auto-applied)`,
    extra: { proposal_id: data.id, status: input.status },
  });

  return data;
}

export async function exportCaseMarkdown(supabase: Client, userId: string, caseId: string): Promise<string> {
  const detail = await getCaseDetail(supabase, caseId);
  if (!detail) throw new Error("Case not found");
  const { caseRow, events, evidence, proposals } = detail;

  const lines: string[] = [];
  lines.push(`# Case #${caseRow.case_number}: ${caseRow.title}`);
  lines.push("");
  lines.push(`- Status: ${caseRow.status}`);
  lines.push(`- Severity: ${caseRow.severity}`);
  lines.push(`- Owner: ${caseRow.owner ?? "unassigned"}`);
  lines.push(`- Opened: ${caseRow.created_at}`);
  if (caseRow.closed_at) lines.push(`- Closed: ${caseRow.closed_at}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(caseRow.summary?.trim() || "_No summary provided._");
  lines.push("");

  lines.push("## Timeline");
  if (events.length === 0) lines.push("_No timeline events recorded._");
  for (const event of events as Array<{ created_at: string; kind: string; actor: string | null; body: string }>) {
    lines.push(`- \`${event.created_at}\` **${event.kind}** (${event.actor ?? "system"}): ${event.body}`);
  }
  lines.push("");

  lines.push("## Evidence");
  if (evidence.length === 0) lines.push("_No evidence attached._");
  for (const item of evidence) {
    lines.push(`### ${item.label} (${item.evidence_kind})`);
    lines.push(
      `- Source: ${item.source ?? "n/a"} · Vantage: ${item.vantage ?? "n/a"} · Fidelity: ${item.fidelity_tier ?? "n/a"}`,
    );
    if (item.window_start || item.window_end) {
      lines.push(`- Window: ${item.window_start ?? "?"} → ${item.window_end ?? "?"}`);
    }
    if (item.record_ids.length > 0) lines.push(`- Record ids: ${item.record_ids.join(", ")}`);
    lines.push(`- Content hash: \`${item.content_hash ?? "n/a"}\``);
    lines.push(`- Custody: ${item.custody.map((c) => `${c.action}@${c.created_at}`).join(" → ") || "none"}`);
    lines.push("");
  }

  lines.push("## Proposals (never applied automatically — recorded for human review only)");
  if (proposals.length === 0) lines.push("_No proposals recorded._");
  for (const proposal of proposals) {
    lines.push(`### ${proposal.title} — ${proposal.status} (risk: ${proposal.risk})`);
    lines.push(`- Target: ${proposal.target ?? "n/a"}`);
    lines.push(`- Rationale: ${proposal.rationale}`);
    if (proposal.reviewer_note) lines.push(`- Reviewer note: ${proposal.reviewer_note}`);
    lines.push("");
  }

  const markdown = lines.join("\n");
  const hash = computeContentHash({ caseId, markdown });

  // Record an export in the custody trail of every piece of evidence included.
  for (const item of evidence) {
    const { error } = await supabase.from("case_custody").insert({
      user_id: userId,
      evidence_id: item.id,
      action: "exported",
      actor: userId,
      detail: { case_id: caseId, export_hash: hash } as never,
      content_hash: item.content_hash,
    });
    if (error) console.error(`[cases] failed to record export custody: ${error.message}`);
  }

  await appendCaseEvent(supabase, userId, {
    caseId,
    kind: "exported",
    actor: userId,
    body: "Case exported as markdown",
    extra: { export_hash: hash },
  });

  return markdown;
}
