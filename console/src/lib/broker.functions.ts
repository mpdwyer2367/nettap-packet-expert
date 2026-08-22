import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DatasetKind } from "./telemetry-parse";
import type { IngestResult } from "./ingest-types";

export type BrokerResourceInput = { label: string; path: string; kind: DatasetKind };

export type BrokerSource = {
  id: string;
  name: string;
  base_url: string;
  auth_style: string;
  auth_header: string | null;
  secret_name: string | null;
  resources: BrokerResourceInput[];
  last_synced_at: string | null;
  last_status: string | null;
  created_at: string;
};

export const listBrokerSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrokerSource[]> => {
    const { data, error } = await context.supabase
      .from("broker_sources")
      .select(
        "id, name, base_url, auth_style, auth_header, secret_name, resources, last_synced_at, last_status, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      ...row,
      resources: (row.resources ?? []) as unknown as BrokerResourceInput[],
    }));

  });

export const saveBrokerSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id?: string;
      name: string;
      base_url: string;
      auth_style: string;
      auth_header?: string | null;
      secret_name?: string | null;
      resources: BrokerResourceInput[];
    }) => {
      if (!input.name?.trim()) throw new Error("Give this broker a name.");
      if (!/^https?:\/\//i.test(input.base_url ?? "")) {
        throw new Error("The API base URL must start with http:// or https://");
      }
      if (!input.resources?.length) throw new Error("Add at least one resource path to pull.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name.trim(),
      base_url: data.base_url.trim(),
      auth_style: data.auth_style,
      auth_header: data.auth_header ?? null,
      secret_name: data.secret_name?.trim() || null,
      resources: data.resources,
    };
    const query = data.id
      ? context.supabase.from("broker_sources").update(row).eq("id", data.id).select("id").single()
      : context.supabase.from("broker_sources").insert(row).select("id").single();
    const { data: saved, error } = await query;
    if (error) throw new Error(error.message);
    return { id: saved.id };
  });

export const deleteBrokerSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("broker_sources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { testBrokerSource } = await import("./broker.server");
    return testBrokerSource(context.supabase, data.id);
  });

export const syncBrokerSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; path: string }) => input)
  .handler(async ({ data, context }): Promise<IngestResult> => {
    const { syncBrokerResource } = await import("./broker.server");
    return syncBrokerResource(context.supabase, context.userId, data.id, data.path);
  });
