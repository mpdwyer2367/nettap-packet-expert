/**
 * Client-safe JSON-schema descriptions of the documentation library tools.
 * Mirrors the shape used in telemetry-tool-schemas.ts.
 */
import type { OllamaToolDef } from "./telemetry-tool-schemas";

function obj(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

export const DOCUMENT_TOOL_NAMES = ["search_nettap_docs", "list_nettap_docs"] as const;

export type DocumentToolName = (typeof DOCUMENT_TOOL_NAMES)[number];

export const DOCUMENT_TOOL_DEFS: OllamaToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_nettap_docs",
      description:
        "Semantic search over the ingested NetTAP documentation library (manuals, config guides, runbooks, release notes, defect notes, design docs). Returns ranked excerpts, each with a citation string and the document/chunk ids so the answer can cite precisely.",
      parameters: obj(
        {
          query: { type: "string" },
          doc_class: nullableString,
          product: nullableString,
          limit: nullableNumber,
        },
        ["query", "doc_class", "product", "limit"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "list_nettap_docs",
      description:
        "List what NetTAP documentation is available in the library: titles, class, product, version, tags and chunk counts. Call this to check coverage before claiming an answer is not documented.",
      parameters: obj({}, []),
    },
  },
];
