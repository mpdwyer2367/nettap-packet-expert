import { createFileRoute } from "@tanstack/react-router";
import {
  managedModel,
  managedOllamaUrl,
  privateHeaders,
  requireConsoleUser,
} from "@/lib/managed-ollama.server";

export const Route = createFileRoute("/api/nettap/ollama/tags")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await requireConsoleUser(request);
        const upstream = await fetch(`${managedOllamaUrl()}/api/tags`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!upstream.ok) return new Response("Managed Ollama is unavailable", { status: 503 });
        const data = (await upstream.json()) as { models?: Array<Record<string, unknown> & { name?: string }> };
        const expected = managedModel().split(":")[0];
        const models = (data.models ?? []).filter((item) => item.name?.split(":")[0] === expected);
        return Response.json({ models }, { headers: privateHeaders() });
      },
    },
  },
});

