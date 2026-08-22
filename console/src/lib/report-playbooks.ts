/**
 * Client-safe metadata for report playbooks. The actual querying/building
 * logic lives in report-playbooks.server.ts and must never be imported from
 * client code.
 */

export type ReportPlaybookId =
  | "triage_summary"
  | "security_exposure"
  | "dns_investigation"
  | "encrypted_traffic"
  | "performance_health";

export type ReportPlaybookMeta = {
  id: ReportPlaybookId;
  label: string;
  description: string;
};

export const REPORT_PLAYBOOKS: ReportPlaybookMeta[] = [
  {
    id: "triage_summary",
    label: "Triage summary",
    description: "Traffic overview, top talkers and protocol mix for a first pass over a dataset.",
  },
  {
    id: "security_exposure",
    label: "Security exposure",
    description: "Risk-tagged traffic — cleartext credentials, remote admin surface and legacy protocols.",
  },
  {
    id: "dns_investigation",
    label: "DNS investigation",
    description: "Query volume, NXDOMAIN rates and possible DNS tunneling candidates.",
  },
  {
    id: "encrypted_traffic",
    label: "Encrypted traffic",
    description: "TLS versions, SNI/certificate inventory and decryption coverage.",
  },
  {
    id: "performance_health",
    label: "Performance health",
    description: "Retransmit/RST signals, top conversations and throughput over time.",
  },
];

export function playbookLabel(id: string | null) {
  return REPORT_PLAYBOOKS.find((playbook) => playbook.id === id)?.label ?? id ?? null;
}
