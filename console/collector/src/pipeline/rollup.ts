import { log } from "../logger.js";
import type { FlowRecord } from "./normalize.js";
import type { ReportedFlowRollup } from "../contract.js";

/** Backpressure high-water mark: raw records queued for the store. */
const HIGH_WATER_MARK = 20_000;
const BUCKET_MS = 60_000;

type RollupKey = string;

type RollupBucket = {
  bucket_ts: number;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string | null;
  app_protocol: string | null;
  service: string | null;
  packets: number;
  bytes: number;
  flow_count: number;
  risk_tags: Set<string>;
  vantage: string;
};

export class RollupEngine {
  private buckets = new Map<RollupKey, RollupBucket>();
  private rawQueue: FlowRecord[] = [];
  private droppedCount = 0;
  private backpressureActive = false;

  /** Ingest a normalized flow: updates the minute rollup and (if capacity allows) queues the raw record. */
  ingest(flow: FlowRecord): void {
    const bucketTs = Math.floor(new Date(flow.ts).getTime() / BUCKET_MS) * BUCKET_MS;
    const key = [
      bucketTs,
      flow.src_ip,
      flow.dst_ip,
      flow.src_port,
      flow.dst_port,
      flow.protocol,
    ].join("|");

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        bucket_ts: bucketTs,
        src_ip: flow.src_ip,
        dst_ip: flow.dst_ip,
        src_port: flow.src_port,
        dst_port: flow.dst_port,
        protocol: flow.protocol,
        app_protocol: flow.app_protocol,
        service: flow.service,
        packets: 0,
        bytes: 0,
        flow_count: 0,
        risk_tags: new Set(),
        vantage: flow.vantage,
      };
      this.buckets.set(key, bucket);
    }
    bucket.packets += flow.packets;
    bucket.bytes += flow.bytes;
    bucket.flow_count += 1;
    for (const tag of flow.risk_tags) bucket.risk_tags.add(tag);

    if (this.rawQueue.length >= HIGH_WATER_MARK) {
      if (!this.backpressureActive) {
        this.backpressureActive = true;
        log.warn("rollup", "Raw flow queue exceeded high-water mark; storing counters only", {
          high_water_mark: HIGH_WATER_MARK,
        });
      }
      this.droppedCount += 1;
      return;
    }
    this.backpressureActive = false;
    this.rawQueue.push(flow);
  }

  /** Drains raw records queued for the local Postgres writer. */
  drainRaw(max = 5000): FlowRecord[] {
    const out = this.rawQueue.splice(0, max);
    return out;
  }

  rawQueueDepth(): number {
    return this.rawQueue.length;
  }

  droppedTotal(): number {
    return this.droppedCount;
  }

  /** Drains completed minute buckets (everything older than the current minute). */
  drainCompletedRollups(): ReportedFlowRollup[] {
    const now = Date.now();
    const currentBucket = Math.floor(now / BUCKET_MS) * BUCKET_MS;
    const out: ReportedFlowRollup[] = [];
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.bucket_ts >= currentBucket) continue;
      out.push({
        bucket_ts: new Date(bucket.bucket_ts).toISOString(),
        src_ip: bucket.src_ip,
        dst_ip: bucket.dst_ip,
        src_port: bucket.src_port,
        dst_port: bucket.dst_port,
        protocol: bucket.protocol,
        app_protocol: bucket.app_protocol,
        service: bucket.service,
        packets: bucket.packets,
        bytes: bucket.bytes,
        flow_count: bucket.flow_count,
        risk_tags: Array.from(bucket.risk_tags),
        vantage: bucket.vantage,
      });
      this.buckets.delete(key);
    }
    return out;
  }
}
