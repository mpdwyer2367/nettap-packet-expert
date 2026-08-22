/**
 * Client-safe types and constants for the case & evidence workspace.
 * No server-only imports here — safe to use from route components.
 */

export const CASE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type CaseSeverity = (typeof CASE_SEVERITIES)[number];

export const CASE_STATUSES = ["open", "investigating", "contained", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const EVIDENCE_KINDS = [
  "flow",
  "packet",
  "log",
  "snmp",
  "wmi",
  "matrix",
  "doc",
  "chart",
  "note",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const PROPOSAL_STATUSES = ["proposed", "accepted", "rejected", "deferred"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type CaseSummary = {
  id: string;
  case_number: number;
  title: string;
  summary: string | null;
  severity: string;
  status: string;
  owner: string | null;
  sites: string[];
  devices: string[];
  investigation_id: string | null;
  dataset_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type CaseDetail = CaseSummary;

export type CaseEventItem = {
  id: number;
  case_id: string;
  kind: string;
  actor: string | null;
  body: string;
  extra: Record<string, unknown>;
  created_at: string;
};

export type CustodyEntry = {
  id: number;
  evidence_id: string;
  action: string;
  actor: string | null;
  detail: Record<string, unknown>;
  content_hash: string | null;
  created_at: string;
};

export type EvidenceItem = {
  id: string;
  case_id: string;
  label: string;
  evidence_kind: string;
  dataset_id: string | null;
  record_ids: number[];
  document_id: string | null;
  chunk_id: string | null;
  connection_id: string | null;
  payload: Record<string, unknown>;
  source: string | null;
  vantage: string | null;
  fidelity_tier: string | null;
  window_start: string | null;
  window_end: string | null;
  content_hash: string | null;
  created_at: string;
  custody: CustodyEntry[];
};

export type ProposalItem = {
  id: string;
  case_id: string;
  connection_id: string | null;
  title: string;
  rationale: string;
  target: string | null;
  change_kind: string;
  proposed_change: Record<string, unknown>;
  risk: string;
  status: string;
  reviewer_note: string | null;
  created_at: string;
  updated_at: string;
};

export function caseSeverityLabel(severity: string): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function caseSeverityVariant(severity: string): "default" | "secondary" | "destructive" | "outline" {
  switch (severity) {
    case "critical":
      return "destructive";
    case "high":
      return "destructive";
    case "medium":
      return "secondary";
    default:
      return "outline";
  }
}

export function caseStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "investigating":
      return "Investigating";
    case "contained":
      return "Contained";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

export function caseStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "open":
      return "default";
    case "investigating":
      return "secondary";
    case "contained":
      return "outline";
    case "closed":
      return "outline";
    default:
      return "outline";
  }
}

export function evidenceKindLabel(kind: string): string {
  switch (kind) {
    case "flow":
      return "Flow";
    case "packet":
      return "Packet";
    case "log":
      return "Log";
    case "snmp":
      return "SNMP";
    case "wmi":
      return "WMI";
    case "matrix":
      return "MATRIX";
    case "doc":
      return "Document";
    case "chart":
      return "Chart";
    case "note":
      return "Note";
    default:
      return kind;
  }
}

export function proposalStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function proposalStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "accepted":
      return "default";
    case "rejected":
      return "destructive";
    case "deferred":
      return "secondary";
    default:
      return "outline";
  }
}

export function riskLabel(risk: string): string {
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}

export function riskVariant(risk: string): "default" | "secondary" | "destructive" | "outline" {
  switch (risk) {
    case "high":
      return "destructive";
    case "medium":
      return "secondary";
    default:
      return "outline";
  }
}
