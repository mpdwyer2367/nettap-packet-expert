import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Copy, Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteReport, generateReport, listReports } from "@/lib/reports.functions";
import { listDatasets } from "@/lib/datasets.functions";
import { downloadMarkdown } from "@/lib/report-builder";
import { REPORT_PLAYBOOKS, playbookLabel } from "@/lib/report-playbooks";
import { MessageResponse } from "@/components/ai-elements/message";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — NetTAP AI" },
      {
        name: "description",
        content:
          "Generate and review NetTAP telemetry reports — investigation write-ups plus one-click triage, security, DNS, encryption and performance playbooks.",
      },
      { property: "og:title", content: "Reports — NetTAP AI" },
      {
        property: "og:description",
        content: "Findings, evidence and visuals captured from your telemetry investigations and playbooks.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportsPage,
});

function sourceBadgeVariant(source: string) {
  return source === "playbook" ? "secondary" : "outline";
}

function NewReportDialog() {
  const queryClient = useQueryClient();
  const fetchDatasets = useServerFn(listDatasets);
  const generate = useServerFn(generateReport);
  const [open, setOpen] = useState(false);
  const [datasetId, setDatasetId] = useState<string>("");
  const [playbook, setPlaybook] = useState<string>("");
  const [title, setTitle] = useState("");

  const { data: datasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => fetchDatasets(),
    enabled: open,
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      generate({
        data: {
          datasetId,
          playbook: playbook as Parameters<typeof generate>[0]["data"]["playbook"],
          title: title.trim() || undefined,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Report generated.");
      setOpen(false);
      setDatasetId("");
      setPlaybook("");
      setTitle("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-3.5 w-3.5" />
          New report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a report</DialogTitle>
          <DialogDescription>
            Pick a dataset and a playbook. The report is built immediately from the dataset's records.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Dataset</label>
            <Select value={datasetId} onValueChange={setDatasetId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a dataset" />
              </SelectTrigger>
              <SelectContent>
                {(datasets ?? []).map((dataset) => (
                  <SelectItem key={dataset.id} value={dataset.id}>
                    {dataset.name} ({dataset.kind})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Playbook</label>
            <Select value={playbook} onValueChange={setPlaybook}>
              <SelectTrigger>
                <SelectValue placeholder="Select a playbook" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_PLAYBOOKS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {playbook && (
              <p className="text-xs text-muted-foreground">
                {REPORT_PLAYBOOKS.find((item) => item.id === playbook)?.description}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Title (optional)</label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Custom report title"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!datasetId || !playbook || generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
          >
            {generateMutation.isPending ? "Generating..." : "Generate report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportsPage() {
  const queryClient = useQueryClient();
  const fetchReports = useServerFn(listReports);
  const remove = useServerFn(deleteReport);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: () => fetchReports(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Report deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copyMarkdown = async (markdown: string) => {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success("Markdown copied.");
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Investigation write-ups and one-click playbooks — findings, cited telemetry and visuals.
          </p>
        </div>
        <NewReportDialog />
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-6">
          {isLoading && <p className="text-sm text-muted-foreground">Loading reports...</p>}
          {!isLoading && (reports ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No reports yet. Use “New report” to run a playbook, or open an investigation and use
              “Report” to capture the analysis.
            </p>
          )}
          {(reports ?? []).map((report) => (
            <section key={report.id} className="rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{report.title}</p>
                    <Badge variant={sourceBadgeVariant(report.source)} className="capitalize">
                      {report.source}
                    </Badge>
                    {report.playbook && <Badge variant="outline">{playbookLabel(report.playbook)}</Badge>}
                    {report.status !== "ready" && (
                      <Badge variant="outline" className="capitalize">
                        {report.status}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {report.created_at.slice(0, 19).replace("T", " ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOpenId(openId === report.id ? null : report.id)}
                >
                  {openId === report.id ? "Hide" : "View"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => copyMarkdown(report.markdown)}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadMarkdown(
                      `${report.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`,
                      report.markdown,
                    )
                  }
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Markdown
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${report.title}`}
                  onClick={() => deleteMutation.mutate(report.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {openId === report.id && (
                <div className="max-h-[70vh] overflow-auto px-5 py-4">
                  <MessageResponse>{report.markdown}</MessageResponse>
                </div>
              )}
            </section>
          ))}
        </div>
      </ScrollArea>
    </AppShell>
  );
}
