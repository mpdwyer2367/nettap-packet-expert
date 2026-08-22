/**
 * Client-safe JSON-schema descriptions of the case & governance tools, mirroring
 * cases-tools.server.ts so a raw-JSON-schema model (e.g. local Ollama) can call them.
 */
import type { OllamaToolDef } from "./telemetry-tool-schemas";

function obj(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}

const nullableString = { type: ["string", "null"] };
const nullableObject = { type: ["object", "null"] };
const nullableNumberArray = { type: ["array", "null"], items: { type: "number" } };

export const CASE_TOOL_NAMES = ["case_open", "case_add_evidence", "case_timeline", "propose_change"] as const;
export type CaseToolName = (typeof CASE_TOOL_NAMES)[number];

export const CASE_TOOL_DEFS: OllamaToolDef[] = [
  {
    type: "function",
    function: {
      name: "case_open",
      description:
        "Open a new case for the current investigation, or reuse an existing one, so evidence and findings can be attached. Returns the case id and case number.",
      parameters: obj(
        {
          title: { type: "string" },
          summary: nullableString,
          severity: { type: ["string", "null"], enum: ["low", "medium", "high", "critical", null] },
          investigationId: nullableString,
          datasetId: nullableString,
          existingCaseId: nullableString,
        },
        ["title", "summary", "severity", "investigationId", "datasetId", "existingCaseId"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "case_add_evidence",
      description:
        "Attach a citable piece of evidence to a case — telemetry record ids, a document chunk, or a chart/note payload — with provenance (source, vantage, fidelity tier, time window). Computes a content hash and records it in the chain of custody. Returns the evidence id and hash.",
      parameters: obj(
        {
          caseId: { type: "string" },
          label: { type: "string" },
          evidenceKind: {
            type: "string",
            enum: ["flow", "packet", "log", "snmp", "wmi", "matrix", "doc", "chart", "note"],
          },
          datasetId: nullableString,
          recordIds: nullableNumberArray,
          documentId: nullableString,
          chunkId: nullableString,
          connectionId: nullableString,
          payload: nullableObject,
          source: nullableString,
          vantage: nullableString,
          fidelityTier: nullableString,
          windowStart: nullableString,
          windowEnd: nullableString,
        },
        [
          "caseId",
          "label",
          "evidenceKind",
          "datasetId",
          "recordIds",
          "documentId",
          "chunkId",
          "connectionId",
          "payload",
          "source",
          "vantage",
          "fidelityTier",
          "windowStart",
          "windowEnd",
        ],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "case_timeline",
      description:
        "Read a case's append-only timeline and its attached evidence list, for status checks and report writing.",
      parameters: obj({ caseId: { type: "string" } }, ["caseId"]),
    },
  },
  {
    type: "function",
    function: {
      name: "propose_change",
      description:
        "Record a recommended MATRIX/broker configuration change with rationale, target, risk and rollback notes, for a human reviewer to accept, reject or defer. This is recorded for human review only and is NEVER executed or pushed to any device automatically.",
      parameters: obj(
        {
          caseId: { type: "string" },
          connectionId: nullableString,
          title: { type: "string" },
          rationale: { type: "string" },
          target: nullableString,
          changeKind: nullableString,
          proposedChange: nullableObject,
          risk: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
          rollback: nullableString,
        },
        ["caseId", "connectionId", "title", "rationale", "target", "changeKind", "proposedChange", "risk", "rollback"],
      ),
    },
  },
];
