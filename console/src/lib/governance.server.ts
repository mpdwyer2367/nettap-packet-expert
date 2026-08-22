import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "./governance";

type Client = SupabaseClient<Database>;

/** Reads the caller's assigned roles from `user_roles`. Defaults to ["user"]. */
export async function loadUserRoles(supabase: Client, userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error || !data || data.length === 0) return ["user"];
  return data.map((row) => row.role as AppRole);
}

export type AuditEventInput = {
  category: string;
  action: string;
  target?: string | null;
  outcome?: string;
  detail?: Record<string, unknown>;
  actor?: string | null;
};

/**
 * Appends an entry to the append-only `audit_events` log. Never throws —
 * failures are logged so they never block the underlying operation.
 */
export async function recordAuditEvent(
  supabase: Client,
  userId: string,
  input: AuditEventInput,
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_events").insert({
      user_id: userId,
      actor: input.actor ?? userId,
      category: input.category,
      action: input.action,
      target: input.target ?? null,
      outcome: input.outcome ?? "success",
      detail: (input.detail ?? {}) as never,
    });
    if (error) console.error(`[audit] failed to record event: ${error.message}`);
  } catch (err) {
    console.error("[audit] failed to record event", err);
  }
}
