import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InvestigationSummary = {
  id: string;
  title: string;
  dataset_id: string | null;
  created_at: string;
  updated_at: string;
};

export const listInvestigations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InvestigationSummary[]> => {
    const { data, error } = await context.supabase
      .from("investigations")
      .select("id, title, dataset_id, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createInvestigation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { title?: string; datasetId?: string | null }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("investigations")
      .insert({
        user_id: context.userId,
        title: data.title?.trim() || "New investigation",
        dataset_id: data.datasetId ?? null,
      })
      .select("id, title, dataset_id, created_at, updated_at")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to create investigation");
    return row;
  });

export const updateInvestigation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; title?: string; datasetId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const patch: { title?: string; dataset_id?: string | null; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if (typeof data.title === "string") patch.title = data.title.trim() || "Untitled investigation";
    if (data.datasetId !== undefined) patch.dataset_id = data.datasetId;

    const { data: row, error } = await context.supabase
      .from("investigations")
      .update(patch)
      .eq("id", data.id)
      .select("id, title, dataset_id, created_at, updated_at")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to update investigation");
    return row;
  });

export const deleteInvestigation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("investigations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getInvestigation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: investigation, error } = await context.supabase
      .from("investigations")
      .select("id, title, dataset_id, created_at, updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!investigation) return null;

    const { data: rows, error: messageError } = await context.supabase
      .from("investigation_messages")
      .select("id, message_id, role, parts, created_at")
      .eq("investigation_id", data.id)
      .order("created_at", { ascending: true });
    if (messageError) throw new Error(messageError.message);

    const messages = (rows ?? []).map((row) => ({
      id: row.message_id ?? row.id,
      role: row.role,
      parts: JSON.stringify(row.parts ?? []),
    }));

    return { investigation, messages };
  });

export const appendInvestigationMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { id: string; messages: { messageId: string; role: string; parts: string }[] }) => input,
  )
  .handler(async ({ data, context }) => {
    for (const message of data.messages) {
      const { error } = await context.supabase.from("investigation_messages").insert({
        user_id: context.userId,
        investigation_id: data.id,
        message_id: message.messageId,
        role: message.role,
        parts: JSON.parse(message.parts) as never,
      });
      if (error) throw new Error(error.message);
    }
    await context.supabase
      .from("investigations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: true };
  });
