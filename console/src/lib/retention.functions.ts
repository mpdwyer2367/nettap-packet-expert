import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { RetentionOverview, RetentionSettings } from "./retention-types";

export const getRetentionOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RetentionOverview> => {
    const { loadRetentionOverview } = await import("./retention.server");
    return loadRetentionOverview(context.supabase, context.userId);
  });

export const saveRetentionSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: RetentionSettings) => {
    const clamp = (n: number, min: number, max: number) =>
      Math.min(Math.max(Math.round(Number(n) || min), min), max);
    return {
      raw_hours: clamp(input.raw_hours, 1, 720),
      metadata_days: clamp(input.metadata_days, 1, 365),
      summary_days: clamp(input.summary_days, 1, 1095),
      chunk_cap: clamp(input.chunk_cap, 100, 100_000),
      enabled: Boolean(input.enabled),
    } satisfies RetentionSettings;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("retention_settings")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return data;
  });

export const setDatasetPinned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; pinned: boolean }) => {
    if (!input?.id) throw new Error("A dataset id is required.");
    return { id: input.id, pinned: Boolean(input.pinned) };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("datasets")
      .update({ pinned: data.pinned })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runRetentionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("run_retention_for_me");
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      rows_rolled: Number(row?.rows_rolled ?? 0),
      rows_deleted: Number(row?.rows_deleted ?? 0),
      chunks_deleted: Number(row?.chunks_deleted ?? 0),
      summaries_written: Number(row?.summaries_written ?? 0),
    };
  });

export const purgeDatasetDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (!input?.id) throw new Error("A dataset id is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { purgeDatasetRaw } = await import("./retention.server");
    return purgeDatasetRaw(context.supabase, data.id);
  });
