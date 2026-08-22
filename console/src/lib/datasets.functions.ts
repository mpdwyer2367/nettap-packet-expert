import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { IngestPayload, IngestResult } from "./ingest-types";

export type DatasetSummary = {
  id: string;
  name: string;
  kind: string;
  status: string;
  record_count: number;
  chunk_count: number;
  range_start: string | null;
  range_end: string | null;
  source_filename: string;
  vantage: string;
  observation_point: string | null;
  created_at: string;
};

export const listDatasets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DatasetSummary[]> => {
    const { data, error } = await context.supabase
      .from("datasets")
      .select(
        "id, name, kind, status, record_count, chunk_count, range_start, range_end, source_filename, vantage, observation_point, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const ingestDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: IngestPayload) => {
    if (!input?.filename) throw new Error("A filename is required.");
    if (!input.capture && !input.text?.trim()) throw new Error("The file appears to be empty.");
    if (input.text && input.text.length > 8_000_000) {
      throw new Error("File too large (limit ~8 MB of text).");
    }
    if (input.capture && input.capture.packets.length === 0) {
      throw new Error("No packets were decoded from this capture.");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<IngestResult> => {
    const { ingestPayload } = await import("./ingest.server");
    return ingestPayload(context.supabase, context.userId, data);
  });

export const deleteDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("datasets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
