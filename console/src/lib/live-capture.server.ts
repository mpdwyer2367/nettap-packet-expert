/**
 * Server-only logic for live capture sessions.
 *
 * The local agent authenticates with a per-session bearer token. Only its SHA-256
 * hash is stored, so a leaked database row cannot be replayed as a valid token.
 */

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { decodeTsharkExport } from "./tshark-import";
import { buildPacketChunks } from "./telemetry-extra";
import { buildFlowChunks, summarizeRange } from "./telemetry-parse";
import { indexChunks } from "./ingest.server";
import { MAX_SESSION_PACKETS, MAX_SLICE_BYTES } from "./live-capture-types";
import type { DecodedPacket } from "./pcap-parse";

type Client = SupabaseClient<Database>;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function mintToken() {
  return randomBytes(32).toString("base64url");
}

export type CreateSessionInput = {
  name: string;
  os: string;
  interfaceName: string;
  captureFilter?: string | null;
  sliceSeconds: number;
  vantage: string;
  observationPoint?: string | null;
};

/** Creates the backing dataset plus the session row, returning the raw token once. */
export async function createSession(supabase: Client, userId: string, input: CreateSessionInput) {
  const { data: dataset, error: datasetError } = await supabase
    .from("datasets")
    .insert({
      user_id: userId,
      name: input.name,
      kind: "packet",
      source_filename: `live:${input.interfaceName}`,
      status: "live",
      record_count: 0,
      vantage: input.vantage,
      observation_point: input.observationPoint?.trim() || input.interfaceName,
      notes: `Live capture from ${input.interfaceName} (${input.os}).`,
    })
    .select("id")
    .single();
  if (datasetError || !dataset) throw new Error(datasetError?.message ?? "Could not create dataset");

  const token = mintToken();
  const { data: session, error } = await supabase
    .from("live_sessions")
    .insert({
      user_id: userId,
      dataset_id: dataset.id,
      os: input.os,
      interface_name: input.interfaceName,
      capture_filter: input.captureFilter?.trim() || null,
      slice_seconds: input.sliceSeconds,
      vantage: input.vantage,
      observation_point: input.observationPoint?.trim() || input.interfaceName,
      token_hash: hashToken(token),
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !session) throw new Error(error?.message ?? "Could not create live session");

  return { sessionId: session.id, datasetId: dataset.id, token };
}

/** Issues a fresh token for an existing session, revoking the previous one. */
export async function rotateToken(supabase: Client, sessionId: string) {
  const token = mintToken();
  const { error } = await supabase
    .from("live_sessions")
    .update({ token_hash: hashToken(token), status: "pending", last_error: null })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
  return token;
}

function truncateToBucket(date: Date, seconds: number) {
  const ms = Math.max(1, seconds) * 1000;
  return new Date(Math.floor(date.getTime() / ms) * ms).toISOString();
}

function rankTop(packets: DecodedPacket[]) {
  const talkers = new Map<string, number>();
  const protocols = new Map<string, number>();
  const ports = new Map<number, number>();
  for (const packet of packets) {
    if (packet.src_ip) talkers.set(packet.src_ip, (talkers.get(packet.src_ip) ?? 0) + packet.length);
    if (packet.dst_ip) talkers.set(packet.dst_ip, (talkers.get(packet.dst_ip) ?? 0) + packet.length);
    if (packet.protocol) protocols.set(packet.protocol, (protocols.get(packet.protocol) ?? 0) + 1);
    if (packet.dst_port) ports.set(packet.dst_port, (ports.get(packet.dst_port) ?? 0) + 1);
  }
  const top = <K,>(map: Map<K, number>, limit = 8) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  return {
    talkers: top(talkers).map(([ip, bytes]) => ({ ip, bytes })),
    protocols: top(protocols).map(([protocol, packets_count]) => ({
      protocol,
      packets: packets_count,
    })),
    ports: top(ports).map(([port, packets_count]) => ({ port, packets: packets_count })),
  };
}

export type SliceResult = {
  packets: number;
  bytes: number;
  session_packets: number;
  status: string;
};

/**
 * Accepts one tshark EK NDJSON slice from the local agent, authenticated by the
 * session token. Runs with the service role *after* the token check, because the
 * agent has no user session.
 */
export async function ingestSlice(token: string, ndjson: string): Promise<SliceResult> {
  if (ndjson.length > MAX_SLICE_BYTES) throw new Error("Slice too large");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: session, error } = await supabaseAdmin
    .from("live_sessions")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!session) throw new Error("Unknown or revoked session token");
  if (new Date(session.expires_at).getTime() < Date.now()) throw new Error("Session expired");
  if (session.status === "stopped" || session.status === "finalized") {
    throw new Error("Session already stopped");
  }
  if (session.status === "paused") {
    return { packets: 0, bytes: 0, session_packets: session.packet_count, status: "paused" };
  }
  if (session.packet_count >= MAX_SESSION_PACKETS) {
    await supabaseAdmin
      .from("live_sessions")
      .update({ status: "stopped", last_error: "Session packet ceiling reached" })
      .eq("id", session.id);
    throw new Error("Session packet ceiling reached — stop and finalize this session");
  }

  const decoded = decodeTsharkExport(ndjson, "live-slice.ek", session.observation_point ?? undefined);
  const base = { dataset_id: session.dataset_id, user_id: session.user_id };

  if (decoded.packets.length > 0) {
    const { error: packetError } = await supabaseAdmin
      .from("packet_records")
      .insert(decoded.packets.map((packet) => ({ ...packet, ...base })));
    if (packetError) throw new Error(packetError.message);
  }
  if (decoded.flows.length > 0) {
    const { error: flowError } = await supabaseAdmin
      .from("flow_records")
      .insert(decoded.flows.map((flow) => ({ ...flow, ...base })));
    if (flowError) throw new Error(flowError.message);
  }

  const bytes = decoded.packets.reduce((total, packet) => total + (packet.length || 0), 0);
  const packetCount = session.packet_count + decoded.packets.length;
  const byteCount = Number(session.byte_count ?? 0) + bytes;
  const bucket = truncateToBucket(new Date(), session.slice_seconds);

  const { data: existing } = await supabaseAdmin
    .from("live_session_metrics")
    .select("id, packets, bytes")
    .eq("session_id", session.id)
    .eq("bucket_ts", bucket)
    .maybeSingle();

  const top = rankTop(decoded.packets);
  if (existing) {
    await supabaseAdmin
      .from("live_session_metrics")
      .update({
        packets: existing.packets + decoded.packets.length,
        bytes: Number(existing.bytes ?? 0) + bytes,
        top,
      })
      .eq("id", existing.id);
  } else {
    await supabaseAdmin.from("live_session_metrics").insert({
      session_id: session.id,
      user_id: session.user_id,
      bucket_ts: bucket,
      packets: decoded.packets.length,
      bytes,
      top,
    });
  }

  await supabaseAdmin
    .from("live_sessions")
    .update({
      status: "live",
      packet_count: packetCount,
      byte_count: byteCount,
      batch_count: session.batch_count + 1,
      last_seen_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", session.id);

  const timestamps = decoded.packets.map((packet) => packet.ts);
  const range = summarizeRange(timestamps);
  await supabaseAdmin
    .from("datasets")
    .update({
      record_count: packetCount,
      range_end: range.end,
      ...(session.batch_count === 0 ? { range_start: range.start } : {}),
    })
    .eq("id", session.dataset_id);

  return {
    packets: decoded.packets.length,
    bytes,
    session_packets: packetCount,
    status: "live",
  };
}

/**
 * Stops the capture and turns the streamed dataset into a normal indexed
 * dataset so it becomes searchable and reportable like an uploaded capture.
 */
export async function finalizeSession(supabase: Client, userId: string, sessionId: string) {
  const { data: session, error } = await supabase
    .from("live_sessions")
    .select("id, dataset_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!session) throw new Error("Session not found");

  await supabase.from("live_sessions").update({ status: "stopped" }).eq("id", sessionId);
  await supabase.from("datasets").update({ status: "indexing" }).eq("id", session.dataset_id);

  const { data: packets } = await supabase
    .from("packet_records")
    .select("id, ts, src_ip, dst_ip, src_port, dst_port, protocol, length, tcp_flags, info")
    .eq("dataset_id", session.dataset_id)
    .order("id", { ascending: true })
    .limit(20000);
  const { data: flows } = await supabase
    .from("flow_records")
    .select("id, ts, src_ip, dst_ip, src_port, dst_port, protocol, bytes, packets, flags, observation_point")
    .eq("dataset_id", session.dataset_id)
    .order("bytes", { ascending: false })
    .limit(20000);

  const chunks = [
    ...buildPacketChunks((packets ?? []) as never),
    ...buildFlowChunks((flows ?? []) as never, 60),
  ];
  const chunkCount = await indexChunks(supabase, userId, session.dataset_id, chunks);

  await supabase
    .from("datasets")
    .update({ status: "ready", chunk_count: chunkCount })
    .eq("id", session.dataset_id);
  await supabase.from("live_sessions").update({ status: "finalized" }).eq("id", sessionId);

  return { datasetId: session.dataset_id, chunks: chunkCount, packets: packets?.length ?? 0 };
}
