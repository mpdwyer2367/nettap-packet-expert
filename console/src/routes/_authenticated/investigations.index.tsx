import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { createInvestigation, listInvestigations } from "@/lib/investigations.functions";

export const Route = createFileRoute("/_authenticated/investigations/")({
  head: () => ({
    meta: [
      { title: "Investigations — NetTAP AI" },
      {
        name: "description",
        content:
          "Open a threaded investigation and question your network telemetry instead of running a manual discovery workflow.",
      },
      { property: "og:title", content: "Investigations — NetTAP AI" },
      {
        property: "og:description",
        content: "Threaded, evidence-cited investigations over your packet-broker telemetry.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InvestigationsIndex,
});

function InvestigationsIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchInvestigations = useServerFn(listInvestigations);
  const createThread = useServerFn(createInvestigation);

  const { data: investigations } = useQuery({
    queryKey: ["investigations"],
    queryFn: () => fetchInvestigations(),
  });

  const createMutation = useMutation({
    mutationFn: () => createThread({ data: {} }),
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({ queryKey: ["investigations"] });
      navigate({ to: "/investigations/$threadId", params: { threadId: thread.id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold tracking-tight">Start an investigation</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {(investigations ?? []).length > 0
              ? "Pick a thread from the sidebar, or open a new one to question a different dataset."
              : "Bind a telemetry dataset to a thread and ask what happened on the wire."}
          </p>
          <Button
            className="mt-5"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            New investigation
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
