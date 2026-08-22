/**
 * Streaming endpoint for the local capture agent.
 *
 * Body: tshark EK NDJSON (`tshark -r slice.pcapng -T ek`).
 * Auth: `Authorization: Bearer <session token>` — verified against the hashed
 * token on the live session before anything is written.
 */

import { createFileRoute } from "@tanstack/react-router";
import { MAX_SLICE_BYTES } from "@/lib/live-capture-types";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/live-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("authorization") ?? "";
        const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        if (!token) return json({ error: "Missing session token" }, 401);

        const body = await request.text();
        if (!body.trim()) return json({ packets: 0, bytes: 0, session_packets: 0, status: "empty" });
        if (body.length > MAX_SLICE_BYTES) {
          return json({ error: "Slice too large — lower the slice length or tighten the filter" }, 413);
        }

        try {
          const { ingestSlice } = await import("@/lib/live-capture.server");
          return json(await ingestSlice(token, body));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Slice could not be ingested";
          const unauthorized = /token|expired|stopped/i.test(message);
          return json({ error: message }, unauthorized ? 401 : 400);
        }
      },
    },
  },
});
