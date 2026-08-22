/**
 * Client-safe tool-to-role authorization map. Server-side enforcement lives in
 * cases-tools.server.ts / telemetry-tools.server.ts callers; this module is the
 * single source of truth for "who may call which analyst tool".
 */
import { TELEMETRY_TOOL_NAMES } from "./telemetry-tool-schemas";

export type AppRole = "user" | "moderator" | "admin";

const ROLE_RANK: Record<AppRole, number> = { user: 0, moderator: 1, admin: 2 };

export type ToolGovernance = {
  minRole: AppRole;
  readOnly: boolean;
};

const NEW_MATRIX_AND_DOC_TOOLS = [
  "matrix_fabric_inventory",
  "matrix_visibility_path",
  "matrix_policy_diff",
  "matrix_port_health",
  "search_nettap_docs",
  "list_nettap_docs",
] as const;

const CASE_TOOL_NAMES_LOCAL = ["case_open", "case_add_evidence", "case_timeline", "propose_change"] as const;

/** Default: every analyst tool is read-only and usable by any authenticated user. */
export const TOOL_GOVERNANCE: Record<string, ToolGovernance> = {};

for (const name of TELEMETRY_TOOL_NAMES) {
  TOOL_GOVERNANCE[name] = { minRole: "user", readOnly: true };
}
for (const name of NEW_MATRIX_AND_DOC_TOOLS) {
  TOOL_GOVERNANCE[name] = { minRole: "user", readOnly: true };
}
for (const name of CASE_TOOL_NAMES_LOCAL) {
  TOOL_GOVERNANCE[name] = { minRole: "user", readOnly: true };
}

// history_sql executes read-only SQL but stays available to every user, per spec.
TOOL_GOVERNANCE["history_sql"] = { minRole: "user", readOnly: true };

// propose_change only ever *records* a proposal (nothing is pushed to a device),
// but recommending a network change is a higher-trust action than reading telemetry.
TOOL_GOVERNANCE["propose_change"] = { minRole: "moderator", readOnly: true };

export function getToolGovernance(toolName: string): ToolGovernance {
  return TOOL_GOVERNANCE[toolName] ?? { minRole: "admin", readOnly: true };
}

export function highestRole(roles: AppRole[]): AppRole {
  if (roles.length === 0) return "user";
  return roles.reduce((best, role) => (ROLE_RANK[role] > ROLE_RANK[best] ? role : best), "user" as AppRole);
}

export function isToolAllowed(toolName: string, roles: AppRole[]): boolean {
  const governance = getToolGovernance(toolName);
  const role = highestRole(roles.length ? roles : ["user"]);
  return ROLE_RANK[role] >= ROLE_RANK[governance.minRole];
}

export function filterAllowedTools(names: string[], roles: AppRole[]): string[] {
  return names.filter((name) => isToolAllowed(name, roles));
}
