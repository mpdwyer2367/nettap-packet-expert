import { createFileRoute } from "@tanstack/react-router";
import {
  managedModel,
  managedOllamaUrl,
  privateHeaders,
  requireConsoleUser,
} from "@/lib/managed-ollama.server";

export const Route = createFileRoute("/api/nettap/ollama/show")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await requireConsoleUser(request);
        const upstream = await fetch(`${managedOllamaUrl()}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: managedModel() }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!upstream.ok) return new Response("Managed model is unavailable", { status: 503 });
        return new Response(upstream.body, {
          status: 200,
          headers: privateHeaders({ "Content-Type": "application/json" }),
        });
      },
    },
  },
});

