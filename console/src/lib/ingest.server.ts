import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { IngestPayload, IngestResult } from "./ingest-types";
import {
  buildFlowChunks,
  buildLogChunks,
  parseTelemetry,
  summarizeRange,
  type ParsedFlow,
  type ParsedLog,
} from "./telemetry-parse";
import {
  buildPacketChunks,
  buildSnmpChunks,
  buildWmiChunks,
  type Chunk,
  type ParsedSnmp,
  type ParsedWmi,
} from "./telemetry-extra";
import { embedTexts } from "./local-embeddings.server";

type Client = SupabaseClient<Database>;
type Row = Record<string, unknown>;

const BATCH = 500;

async function insertBatched(supabase: Client, table: string, rows: Row[]): Promise<number[]> {
  const ids: number[] = [];
  for (let index = 0; index < rows.length; index += BATCH) {
    const { data, error } = await supabase
      // Table names are validated by the callers below.
      .from(table as never)
      .insert(rows.slice(index, index + BATCH) as never)
      .select("id");
    if (error) throw new Error(`Failed to store ${table}: ${error.message}`);
    for (const row of (data ?? []) as { id: number }[]) ids.push(row.id);
  }
  return ids;
}

export async function indexChunks(
  supabase: Client,
  userId: string,
  datasetId: string,
  chunks: Chunk[],
): Promise<number> {
  if (chunks.length === 0) return 0;

  const vectors = await embedTexts(
    chunks.map((chunk) => chunk.content),
  );
  const rows = chunks
    .map((chunk, index) => ({ chunk, vector: vectors[index] }))
    // Skip any chunk whose embedding is missing so a partial batch cannot fail the insert.
    .filter((entry): entry is { chunk: Chunk; vector: number[] } => Boolean(entry.vector?.length))
    .map(({ chunk, vector }) => ({
    user_id: userId,
    dataset_id: datasetId,
    kind: chunk.kind,
    content: chunk.content,
      record_ids: chunk.record_ids,
      embedding: JSON.stringify(vector),
    }));

  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await supabase.from("telemetry_chunks").insert(rows.slice(index, index + 100));
    if (error) throw new Error(`Failed to store telemetry index: ${error.message}`);
  }
  return rows.length;
}

/**
 * Stores one telemetry payload: either raw text (flow/log/SNMP/WMI tables and
 * syslog) or a browser-decoded packet capture, then builds the RAG index.
 */
export async function ingestPayload(
  supabase: Client,
  userId: string,
  payload: IngestPayload,
): Promise<IngestResult> {
  const capture = payload.capture;
  const parsed = capture ? null : parseTelemetry(payload.filename, payload.text ?? "", payload.hint, payload.columnMapping);

  const kind = capture ? ("packet" as const) : parsed!.kind;
  const timestamps = capture
    ? capture.packets.map((packet) => packet.ts)
    : parsed!.kind === "flow"
      ? parsed!.flows.map((flow) => flow.ts)
      : parsed!.kind === "log"
        ? parsed!.logs.map((log) => log.ts)
        : parsed!.kind === "snmp"
          ? parsed!.snmp.map((record) => record.ts)
          : parsed!.wmi.map((record) => record.ts);

  const recordCount = capture
    ? capture.packets.length
    : parsed!.kind === "flow"
      ? parsed!.flows.length
      : parsed!.kind === "log"
        ? parsed!.logs.length
        : parsed!.kind === "snmp"
          ? parsed!.snmp.length
          : parsed!.wmi.length;

  if (recordCount === 0) throw new Error("No telemetry records could be parsed from this file.");

  const range = summarizeRange(timestamps);
  const { data: dataset, error: datasetError } = await supabase
    .from("datasets")
    .insert({
      user_id: userId,
      name: payload.name.trim() || payload.filename,
      source_filename: payload.filename,
      kind,
      status: "indexing",
      record_count: recordCount,
      range_start: range.start,
      range_end: range.end,
      vantage: payload.vantage ?? "unknown",
      observation_point: payload.observationPoint?.trim() || null,
    })
    .select("id")
    .single();
  if (datasetError || !dataset) throw new Error(datasetError?.message ?? "Failed to create dataset");

  const datasetId = dataset.id;
  const base = { dataset_id: datasetId, user_id: userId };
  let chunks: Chunk[] = [];
  const skipped = capture ? capture.skipped : parsed!.skipped;
  let note: string | undefined;

  if (capture) {
    const packetIds = await insertBatched(
      supabase,
      "packet_records",
      capture.packets.map((packet) => ({ ...packet, ...base })),
    );
    // Captures also produce rolled-up conversations so flow tools work on them.
    const flowIds = await insertBatched(
      supabase,
      "flow_records",
      capture.flows.map((flow) => ({ ...flow, ...base })),
    );

    chunks = [
      ...buildPacketChunks(
        capture.packets.map((packet, index) => ({ ...packet, id: packetIds[index] ?? 0 })),
      ),
      ...buildFlowChunks(
        capture.flows.map((flow, index) => ({ ...flow, id: flowIds[index] ?? 0 })),
        60,
      ),
    ];
    if (capture.sampled) {
      note = `Capture held ${capture.totalPackets.toLocaleString()} frames — evenly sampled down to ${capture.packets.length.toLocaleString()}.`;
    }
  } else if (parsed!.kind === "flow") {
    const flows: ParsedFlow[] = parsed!.flows;
    const ids = await insertBatched(
      supabase,
      "flow_records",
      flows.map((flow) => ({ ...flow, ...base })),
    );
    chunks = buildFlowChunks(flows.map((flow, index) => ({ ...flow, id: ids[index] ?? 0 })));
  } else if (parsed!.kind === "log") {
    const logs: ParsedLog[] = parsed!.logs;
    const ids = await insertBatched(
      supabase,
      "log_records",
      logs.map((log) => ({ ...log, ...base })),
    );
    chunks = buildLogChunks(logs.map((log, index) => ({ ...log, id: ids[index] ?? 0 })));
  } else if (parsed!.kind === "snmp") {
    const records: ParsedSnmp[] = parsed!.snmp;
    const ids = await insertBatched(
      supabase,
      "snmp_records",
      records.map((record) => ({ ...record, ...base })),
    );
    chunks = buildSnmpChunks(records.map((record, index) => ({ ...record, id: ids[index] ?? 0 })));
  } else {
    const records: ParsedWmi[] = parsed!.wmi;
    const ids = await insertBatched(
      supabase,
      "wmi_records",
      records.map((record) => ({ ...record, ...base })),
    );
    chunks = buildWmiChunks(records.map((record, index) => ({ ...record, id: ids[index] ?? 0 })));
  }

  const chunkCount = await indexChunks(supabase, userId, datasetId, chunks);

  const { error: updateError } = await supabase
    .from("datasets")
    .update({ status: "ready", chunk_count: chunkCount })
    .eq("id", datasetId);
  if (updateError) throw new Error(updateError.message);

  return { id: datasetId, kind, records: recordCount, chunks: chunkCount, skipped, note };
}
