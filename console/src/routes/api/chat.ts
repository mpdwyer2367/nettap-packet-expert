import { createFileRoute } from "@tanstack/react-router";

/**
 * Legacy Lovable hosted-inference route. The appliance intentionally fails
 * closed here so old clients cannot bypass the managed NetTAP model contract.
 */
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async () =>
        new Response(
          "Hosted inference is disabled. Use the managed NetTAP console model endpoint.",
          { status: 410, headers: { "Cache-Control": "no-store" } },
        ),
    },
  },
});
