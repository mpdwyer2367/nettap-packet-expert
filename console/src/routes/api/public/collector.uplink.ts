/**
 * Batched telemetry uplink from the collector appliance: interface counters,
 * flow rollups, exporter health, probe results, device facts and optional
 * tshark EK packet metadata.
 */

import { createFileRoute } from "@tanstack/react-router";
import { MAX_UPLINK_BYTES } from "@/lib/collector-types";
import type { UplinkRequest } from "@/lib/collector-types";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/collector/uplink")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("authorization") ?? "";
        const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        if (!token) return json({ error: "Missing collector token" }, 401);

        const raw = await request.text();
        if (!raw.trim()) return json({ error: "Empty batch" }, 400);
        if (raw.length > MAX_UPLINK_BYTES) {
          return json({ error: "Batch too large — lower batch_seconds or disable packet push" }, 413);
        }

        let body: UplinkRequest;
        try {
          body = JSON.parse(raw) as UplinkRequest;
        } catch {
          return json({ error: "Body must be JSON" }, 400);
        }

        try {
          const { handleUplink, signatureMatches } = await import("@/lib/collector.server");
          if (!signatureMatches(request.headers.get("x-amdai-signature"), raw, token)) {
            return json({ error: "Signature mismatch" }, 401);
          }
          return json(await handleUplink(token, body));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Batch could not be stored";
          return json({ error: message }, /token/i.test(message) ? 401 : 400);
        }
      },
    },
  },
});
