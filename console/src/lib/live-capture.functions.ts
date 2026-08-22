import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  LiveMetricBucket,
  LiveSessionSummary,
} from "./live-capture-types";

export const listLiveSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LiveSessionSummary[]> => {
    const { data, error } = await context.supabase
      .from("live_sessions")
      .select(
        "id, dataset_id, os, interface_name, capture_filter, slice_seconds, vantage, observation_point, status, packet_count, byte_count, batch_count, last_error, last_seen_at, expires_at, created_at, datasets(name)",
      )
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => {
      const { datasets, ...rest } = row as typeof row & { datasets: { name: string } | null };
      return { ...rest, dataset_name: datasets?.name ?? "Live capture" } as LiveSessionSummary;
    });
  });

export const createLiveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      name: string;
      os: string;
      interfaceName: string;
      captureFilter?: string | null;
      sliceSeconds: number;
      vantage: string;
      observationPoint?: string | null;
    }) => {
      if (!input?.interfaceName?.trim()) throw new Error("An interface name is required.");
      if (!["windows", "macos", "linux"].includes(input.os)) throw new Error("Unsupported OS.");
      const slice = Number(input.sliceSeconds);
      if (!Number.isFinite(slice) || slice < 2 || slice > 60) {
        throw new Error("Slice length must be between 2 and 60 seconds.");
      }
      return { ...input, name: input.name?.trim() || `Live ${input.interfaceName.trim()}`, sliceSeconds: Math.round(slice) };
    },
  )
  .handler(async ({ data, context }) => {
    const { createSession } = await import("./live-capture.server");
    return createSession(context.supabase, context.userId, data);
  });

export const rotateLiveToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (!input?.id) throw new Error("A session id is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: session, error } = await context.supabase
      .from("live_sessions")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) throw new Error("Session not found");
    const { rotateToken } = await import("./live-capture.server");
    return { token: await rotateToken(context.supabase, data.id) };
  });

export const setLiveSessionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; status: "live" | "paused" | "stopped" }) => {
    if (!input?.id) throw new Error("A session id is required.");
    if (!["live", "paused", "stopped"].includes(input.status)) throw new Error("Invalid status.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("live_sessions")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getLiveMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; limit?: number }) => {
    if (!input?.id) throw new Error("A session id is required.");
    return input;
  })
  .handler(async ({ data, context }): Promise<LiveMetricBucket[]> => {
    const { data: rows, error } = await context.supabase
      .from("live_session_metrics")
      .select("bucket_ts, packets, bytes, top")
      .eq("session_id", data.id)
      .order("bucket_ts", { ascending: false })
      .limit(Math.min(240, Math.max(10, data.limit ?? 60)));
    if (error) throw new Error(error.message);
    return ((rows ?? []) as LiveMetricBucket[]).slice().reverse();
  });

export const finalizeLiveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (!input?.id) throw new Error("A session id is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { finalizeSession } = await import("./live-capture.server");
    return finalizeSession(context.supabase, context.userId, data.id);
  });

export const deleteLiveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; deleteDataset?: boolean }) => {
    if (!input?.id) throw new Error("A session id is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: session } = await context.supabase
      .from("live_sessions")
      .select("dataset_id")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase.from("live_sessions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (data.deleteDataset && session?.dataset_id) {
      await context.supabase.from("datasets").delete().eq("id", session.dataset_id);
    }
    return { ok: true };
  });
