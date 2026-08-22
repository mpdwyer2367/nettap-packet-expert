/**
 * Client-safe JSON-schema descriptions of the MATRIX tools for the local
 * Ollama model. Execution happens server-side in matrix-tools.server.ts.
 */
import type { OllamaToolDef } from "./telemetry-tool-schemas";

function obj(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

export const MATRIX_TOOL_NAMES = [
  "matrix_fabric_inventory",
  "matrix_visibility_path",
  "matrix_policy_diff",
  "matrix_port_health",
] as const;

export type MatrixToolName = (typeof MATRIX_TOOL_NAMES)[number];

export const MATRIX_TOOL_DEFS: OllamaToolDef[] = [
  {
    type: "function",
    function: {
      name: "matrix_fabric_inventory",
      description:
        "List MATRIX fabric devices, ports and links with health, optionally filtered by connection or site.",
      parameters: obj(
        { connection_id: nullableString, site: nullableString },
        ["connection_id", "site"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "matrix_visibility_path",
      description:
        "Trace what a tool actually receives from an ingress TAP/SPAN port or source IP/segment through the visibility policies to the tool ports, and report blind spots.",
      parameters: obj(
        {
          connection_id: nullableString,
          ingress_port_key: nullableString,
          source: nullableString,
        },
        ["connection_id", "ingress_port_key", "source"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "matrix_policy_diff",
      description:
        "Compare visibility policies between two MATRIX config revisions and report added, removed and changed policies.",
      parameters: obj(
        {
          connection_id: { type: "string" },
          from_revision: { type: "number" },
          to_revision: { type: "number" },
        },
        ["connection_id", "from_revision", "to_revision"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "matrix_port_health",
      description:
        "Report counters, utilization, errors, discards and active alarms for a MATRIX port or all ports on a device.",
      parameters: obj(
        {
          connection_id: nullableString,
          port_key: nullableString,
          device_key: nullableString,
        },
        ["connection_id", "port_key", "device_key"],
      ),
    },
  },
];
