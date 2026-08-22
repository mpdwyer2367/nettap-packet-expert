import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { ChatMessage } from "@/lib/ollama";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { InvestigationChat } from "@/components/investigation-chat";
import { listDatasets } from "@/lib/datasets.functions";
import { getInvestigation, updateInvestigation } from "@/lib/investigations.functions";

export const Route = createFileRoute("/_authenticated/investigations/$threadId")({
  head: () => ({
    meta: [
      { title: "Investigation — NetTAP AI" },
      {
        name: "description",
        content:
          "Chat with your network telemetry: flows, IPFIX/NetFlow records and device logs, with cited evidence.",
      },
      { property: "og:title", content: "Investigation — NetTAP AI" },
      {
        property: "og:description",
        content: "Evidence-cited answers from your packet-broker telemetry.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InvestigationPage,
});

function InvestigationPage() {
  const { threadId } = Route.useParams();
  const queryClient = useQueryClient();

  const loadInvestigation = useServerFn(getInvestigation);
  const patchInvestigation = useServerFn(updateInvestigation);
  const fetchDatasets = useServerFn(listDatasets);

  const { data: thread, isLoading } = useQuery({
    queryKey: ["investigation", threadId],
    queryFn: () => loadInvestigation({ data: { id: threadId } }),
  });

  const { data: datasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => fetchDatasets(),
  });

  const patchMutation = useMutation({
    mutationFn: (input: { title?: string; datasetId?: string | null }) =>
      patchInvestigation({ data: { id: threadId, ...input } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["investigation", threadId] });
      await queryClient.invalidateQueries({ queryKey: ["investigations"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading investigation...
        </div>
      </AppShell>
    );
  }

  if (!thread) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          This investigation no longer exists.
        </div>
      </AppShell>
    );
  }

  const initialMessages: ChatMessage[] = thread.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      id: message.id,
      role: message.role as ChatMessage["role"],
      parts: JSON.parse(message.parts) as ChatMessage["parts"],
    }));


  return (
    <AppShell>
      <InvestigationChat
        key={threadId}
        threadId={threadId}
        initialMessages={initialMessages}
        datasets={datasets ?? []}
        datasetId={thread.investigation.dataset_id}
        onDatasetChange={(datasetId) => patchMutation.mutate({ datasetId })}
        onFirstMessage={(text) => patchMutation.mutate({ title: text.slice(0, 70) })}
      />
    </AppShell>
  );
}
