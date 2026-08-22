import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { DatasetKind } from "./telemetry-parse";
import { ingestPayload } from "./ingest.server";

type Client = SupabaseClient<Database>;

export type BrokerResource = {
  label: string;
  path: string;
  kind: DatasetKind;
};

/** Flattens a JSON array of objects into CSV so the normal parsers can run. */
export function jsonToCsv(rows: Record<string, unknown>[]): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");
}

function unwrapArray(body: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object") {
    for (const key of ["data", "records", "results", "items", "flows", "logs", "rows"]) {
      const candidate = (body as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
    }
  }
  return null;
}

function authHeaders(source: {
  auth_style: string;
  auth_header: string | null;
  secret_name: string | null;
}) {
  const token = source.secret_name ? process.env[source.secret_name] : undefined;
  if (!token) {
    if (source.auth_style === "none") return {};
    throw new Error(
      `No credential found for this broker. Save the API token as the secret "${source.secret_name ?? "NETTAP_BROKER_TOKEN"}" first.`,
    );
  }
  if (source.auth_style === "header") return { [source.auth_header || "X-Api-Key"]: token };
  if (source.auth_style === "basic") return { Authorization: `Basic ${btoa(token)}` };
  return { Authorization: `Bearer ${token}` };
}

/** Fetches one broker resource and ingests it as a dataset. */
export async function syncBrokerResource(
  supabase: Client,
  userId: string,
  sourceId: string,
  resourcePath: string,
) {
  const { data: source, error } = await supabase
    .from("broker_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!source) throw new Error("Broker source not found.");

  const resources = (source.resources ?? []) as unknown as BrokerResource[];
  const resource = resources.find((item) => item.path === resourcePath) ?? resources[0];
  if (!resource) throw new Error("This broker source has no resources configured.");

  const url = `${source.base_url.replace(/\/$/, "")}/${resource.path.replace(/^\//, "")}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json, text/csv;q=0.9, */*;q=0.5", ...authHeaders(source) },
    });
  } catch (fetchError) {
    const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
    throw new Error(`Could not reach ${url}: ${message}`);
  }

  const raw = await response.text();
  if (!response.ok) {
    await supabase
      .from("broker_sources")
      .update({ last_status: `error ${response.status}` })
      .eq("id", sourceId);
    throw new Error(`Broker responded ${response.status}: ${raw.slice(0, 400)}`);
  }

  let text = raw;
  if (raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")) {
    const rows = unwrapArray(JSON.parse(raw) as unknown);
    if (!rows || rows.length === 0) throw new Error("The broker returned no records for this resource.");
    text = jsonToCsv(rows);
  }

  const result = await ingestPayload(supabase, userId, {
    name: `${source.name} — ${resource.label}`,
    filename: `${resource.label.replace(/\s+/g, "-").toLowerCase()}.csv`,
    text,
    hint: resource.kind,
  });

  await supabase
    .from("broker_sources")
    .update({ last_status: `synced ${result.records} records`, last_synced_at: new Date().toISOString() })
    .eq("id", sourceId);

  return result;
}

/** Lightweight reachability/auth probe used by the "Test" button. */
export async function testBrokerSource(supabase: Client, sourceId: string) {
  const { data: source, error } = await supabase
    .from("broker_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!source) throw new Error("Broker source not found.");

  const resources = (source.resources ?? []) as unknown as BrokerResource[];
  const path = resources[0]?.path ?? "";
  const url = `${source.base_url.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

  try {
    const response = await fetch(url, { headers: authHeaders(source) });
    const status = `${response.status} ${response.statusText}`.trim();
    await supabase.from("broker_sources").update({ last_status: status }).eq("id", sourceId);
    return { ok: response.ok, status, url };
  } catch (fetchError) {
    const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
    await supabase.from("broker_sources").update({ last_status: `unreachable` }).eq("id", sourceId);
    return { ok: false, status: message, url };
  }
}
