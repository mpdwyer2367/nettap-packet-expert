// Client-safe types and constants for the NetTAP documentation RAG library.

export const DOC_CLASSES = [
  {
    value: "manual",
    label: "Manual",
    description: "Product manuals and user guides.",
  },
  {
    value: "config_guide",
    label: "Config guide",
    description: "Step-by-step configuration and deployment guides.",
  },
  {
    value: "runbook",
    label: "Runbook",
    description: "Operational runbooks for incidents and maintenance.",
  },
  {
    value: "release_notes",
    label: "Release notes",
    description: "Version release notes and changelogs.",
  },
  {
    value: "defect_note",
    label: "Defect note",
    description: "Known issues, defects and workarounds.",
  },
  {
    value: "design_doc",
    label: "Design doc",
    description: "Architecture and design documentation.",
  },
] as const;

export type DocClass = (typeof DOC_CLASSES)[number]["value"];

export const DOC_CLASS_LABELS: Record<string, string> = Object.fromEntries(
  DOC_CLASSES.map((entry) => [entry.value, entry.label]),
);

export const ACCEPTED_UPLOAD_EXTENSIONS = [".md", ".txt", ".csv", ".json", ".html"] as const;
export const ACCEPTED_UPLOAD_ACCEPT = ACCEPTED_UPLOAD_EXTENSIONS.join(",");

export const MAX_DOCUMENT_TEXT_BYTES = 4 * 1024 * 1024; // ~4 MB

export type DocumentSummary = {
  id: string;
  title: string;
  doc_class: string;
  product: string | null;
  version: string | null;
  source_filename: string | null;
  tags: string[];
  min_role: string;
  chunk_count: number;
  char_count: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentChunkPreview = {
  id: string;
  chunk_index: number;
  section: string | null;
  page: number | null;
  anchor: string | null;
  content: string;
};

export type DocumentChunkHit = {
  chunk_id: string;
  document_id: string;
  title: string;
  doc_class: string;
  product: string | null;
  version: string | null;
  section: string | null;
  page: number | null;
  anchor: string | null;
  content: string;
  similarity: number;
  citation: string;
};

export type DocCitation = {
  title: string;
  version: string | null;
  section: string | null;
  page: number | null;
};

/**
 * Formats a human-readable citation like:
 * "[NetTAP Broker Manual v4.2 § Port mirroring, p.31]"
 */
export function formatCitation(citation: DocCitation): string {
  const parts: string[] = [citation.title];
  if (citation.version) parts.push(`v${citation.version.replace(/^v/i, "")}`);
  let label = parts.join(" ");
  const extras: string[] = [];
  if (citation.section) extras.push(`§ ${citation.section}`);
  if (typeof citation.page === "number") extras.push(`p.${citation.page}`);
  if (extras.length > 0) label += ` ${extras.join(", ")}`;
  return `[${label}]`;
}
