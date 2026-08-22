/**
 * Collector appliance check-in.
 *
 * Auth: `Authorization: Bearer <collector token>`, optionally reinforced with
 * `x-amdai-signature`. Verified against the hashed token before anything writes.
 */

import { createFileRoute } from "@tanstack/react-router";
import { MAX_UPLINK_BYTES } from "@/lib/collector-types";
import type { HeartbeatRequest } from "@/lib/collector-types";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export const Route = createFileRoute("/api/public/collector/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return json({ error: "Missing collector token" }, 401);

        const raw = await request.text();
        if (raw.length > MAX_UPLINK_BYTES) return json({ error: "Heartbeat too large" }, 413);

        let body: HeartbeatRequest;
        try {
          body = JSON.parse(raw || "{}") as HeartbeatRequest;
        } catch {
          return json({ error: "Body must be JSON" }, 400);
        }

        try {
          const { handleHeartbeat, signatureMatches } = await import("@/lib/collector.server");
          if (!signatureMatches(request.headers.get("x-amdai-signature"), raw, token)) {
            return json({ error: "Signature mismatch" }, 401);
          }
          return json(await handleHeartbeat(token, body));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Heartbeat failed";
          return json({ error: message }, /token/i.test(message) ? 401 : 400);
        }
      },
    },
  },
});
