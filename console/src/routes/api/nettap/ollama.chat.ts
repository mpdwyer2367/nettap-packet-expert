import { createFileRoute } from "@tanstack/react-router";
import {
  acquireOllamaSlot,
  managedOllamaUrl,
  privateHeaders,
  readManagedChatBody,
  requireConsoleUser,
} from "@/lib/managed-ollama.server";

export const Route = createFileRoute("/api/nettap/ollama/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await requireConsoleUser(request);
        const release = acquireOllamaSlot(userId);
        try {
          const body = await readManagedChatBody(request);
          const upstream = await fetch(`${managedOllamaUrl()}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
            body: JSON.stringify(body),
            signal: request.signal,
          });
          if (!upstream.ok || !upstream.body) {
            release();
            return new Response("Managed model request failed", { status: 503 });
          }
          const [clientBody, completionBody] = upstream.body.tee();
          void completionBody.pipeTo(new WritableStream()).finally(release);
          return new Response(clientBody, {
            status: 200,
            headers: privateHeaders({ "Content-Type": "application/x-ndjson" }),
          });
        } catch (error) {
          release();
          throw error;
        }
      },
    },
  },
});
