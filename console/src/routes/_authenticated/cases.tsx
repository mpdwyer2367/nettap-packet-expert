import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CASE_SEVERITIES,
  CASE_STATUSES,
  caseSeverityLabel,
  caseSeverityVariant,
  caseStatusLabel,
  caseStatusVariant,
  evidenceKindLabel,
  proposalStatusLabel,
  proposalStatusVariant,
  riskLabel,
  riskVariant,
  type CaseEventItem,
  type EvidenceItem,
  type ProposalItem,
} from "@/lib/case-types";
import {
  addCaseEvent,
  createCase,
  deleteCaseEvidence,
  exportCaseMarkdown,
  getCase,
  listCasesFn,
  reviewProposal,
  updateCase,
} from "@/lib/cases.functions";
import { downloadMarkdown } from "@/lib/report-builder";

export const Route = createFileRoute("/_authenticated/cases")({
  head: () => ({
    meta: [
      { title: "Cases — NetTAP AI" },
      {
        name: "description",
        content:
          "Case & evidence workspace: append-only timelines, chain-of-custody evidence and human-reviewed change proposals. Nothing is ever pushed to the network automatically.",
      },
      { property: "og:title", content: "Cases — NetTAP AI" },
      {
        property: "og:description",
        content: "Investigate, document and review — every proposed change stays read-only until a human approves it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CasesPage,
});

function NewCaseDialog() {
  const queryClient = useQueryClient();
  const create = useServerFn(createCase);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [severity, setSeverity] = useState<string>("medium");

  const mutation = useMutation({
    mutationFn: () => create({ data: { title, summary: summary || null, severity } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cases"] });
      toast.success("Case opened.");
      setOpen(false);
      setTitle("");
      setSummary("");
      setSeverity("medium");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-3.5 w-3.5" />
          New case
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open a case</DialogTitle>
          <DialogDescription>Track findings, evidence and reviewed change proposals in one place.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Suspicious outbound traffic from 10.0.0.5" />
          </div>
          <div className="space-y-1.5">
            <Label>Summary (optional)</Label>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CASE_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {caseSeverityLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!title.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Opening..." : "Open case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvidenceRow({ item, caseId }: { item: EvidenceItem; caseId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const remove = useServerFn(deleteCaseEvidence);

  const deleteMutation = useMutation({
    mutationFn: () => remove({ data: { id: item.id, caseId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
      toast.success("Evidence removed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <TableRow>
        <TableCell>
          <button className="flex items-center gap-1 text-left" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {item.label}
          </button>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{evidenceKindLabel(item.evidence_kind)}</Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{item.source ?? "—"}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{item.vantage ?? "—"}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{item.fidelity_tier ?? "—"}</TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {item.window_start ? `${item.window_start.slice(0, 16)} → ${item.window_end?.slice(0, 16) ?? "?"}` : "—"}
        </TableCell>
        <TableCell className="font-mono text-[11px] text-muted-foreground">
          {item.content_hash ? `${item.content_hash.slice(0, 12)}…` : "—"}
        </TableCell>
        <TableCell>
          <Button size="icon-sm" variant="ghost" onClick={() => deleteMutation.mutate()} aria-label={`Remove ${item.label}`}>
            ×
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30">
            <div className="space-y-1 py-2 text-xs">
              <p className="font-medium">Chain of custody</p>
              {item.custody.length === 0 && <p className="text-muted-foreground">No custody entries.</p>}
              {item.custody.map((c) => (
                <p key={c.id} className="font-mono text-muted-foreground">
                  {c.created_at.slice(0, 19).replace("T", " ")} · {c.action} · {c.actor ?? "system"} ·{" "}
                  {c.content_hash ? `${c.content_hash.slice(0, 16)}…` : "no hash"}
                </p>
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ProposalsSection({ caseId, proposals }: { caseId: string; proposals: ProposalItem[] }) {
  const queryClient = useQueryClient();
  const review = useServerFn(reviewProposal);
  const [note, setNote] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      review({ data: { id: input.id, caseId, status: input.status, reviewerNote: note[input.id] || null } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
      toast.success("Proposal reviewed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-3">
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Recorded for human review — never applied automatically</AlertTitle>
        <AlertDescription>
          Proposals are recommendations only. Accepting one here does not change any device, broker or policy — it
          only records the reviewer's decision.
        </AlertDescription>
      </Alert>
      {proposals.length === 0 && <p className="text-sm text-muted-foreground">No proposals recorded.</p>}
      {proposals.map((p) => (
        <div key={p.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{p.title}</p>
            <Badge variant={riskVariant(p.risk)}>{riskLabel(p.risk)} risk</Badge>
            <Badge variant={proposalStatusVariant(p.status)}>{proposalStatusLabel(p.status)}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Target: {p.target ?? "n/a"}</p>
          <p className="mt-1 text-sm">{p.rationale}</p>
          {p.reviewer_note && <p className="mt-1 text-xs italic text-muted-foreground">Note: {p.reviewer_note}</p>}
          {p.status === "proposed" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                placeholder="Reviewer note (optional)"
                className="h-8 max-w-xs text-xs"
                value={note[p.id] ?? ""}
                onChange={(e) => setNote((prev) => ({ ...prev, [p.id]: e.target.value }))}
              />
              <Button size="sm" onClick={() => mutation.mutate({ id: p.id, status: "accepted" })}>
                Accept
              </Button>
              <Button size="sm" variant="outline" onClick={() => mutation.mutate({ id: p.id, status: "deferred" })}>
                Defer
              </Button>
              <Button size="sm" variant="destructive" onClick={() => mutation.mutate({ id: p.id, status: "rejected" })}>
                Reject
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CaseDetailPane({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const fetchCase = useServerFn(getCase);
  const update = useServerFn(updateCase);
  const addEvent = useServerFn(addCaseEvent);
  const exportMd = useServerFn(exportCaseMarkdown);
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => fetchCase({ data: { id: caseId } }),
  });

  const updateMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => update({ data: { id: caseId, ...patch } as never }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
      await queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const noteMutation = useMutation({
    mutationFn: () => addEvent({ data: { caseId, kind: "note", body: note } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
      setNote("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const exportMutation = useMutation({
    mutationFn: () => exportMd({ data: { id: caseId } }),
    onSuccess: (result) => {
      const title = data?.caseRow.title ?? "case";
      downloadMarkdown(`${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`, result.markdown);
      toast.success("Case exported.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading case...</p>;
  if (!data) return <p className="p-6 text-sm text-muted-foreground">Case not found.</p>;

  const { caseRow, events, evidence, proposals } = data;

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Case #{caseRow.case_number}</p>
            <h2 className="text-lg font-semibold">{caseRow.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{caseRow.summary ?? "No summary."}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            <Download className="mr-2 h-3.5 w-3.5" />
            Export case
          </Button>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={caseRow.status} onValueChange={(v) => updateMutation.mutate({ status: v })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CASE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {caseStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Severity</Label>
            <Select value={caseRow.severity} onValueChange={(v) => updateMutation.mutate({ severity: v })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CASE_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {caseSeverityLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Owner</Label>
            <Input
              className="w-48"
              defaultValue={caseRow.owner ?? ""}
              onBlur={(e) => updateMutation.mutate({ owner: e.target.value || null })}
            />
          </div>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Timeline (append-only)</h3>
          <div className="space-y-2">
            {events.length === 0 && <p className="text-sm text-muted-foreground">No events yet.</p>}
            {(events as CaseEventItem[]).map((e) => (
              <div key={e.id} className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{e.kind}</Badge>
                  <span className="text-xs text-muted-foreground">{e.created_at.slice(0, 19).replace("T", " ")}</span>
                </div>
                <p className="mt-1">{e.body}</p>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the timeline" />
              <Button size="sm" disabled={!note.trim() || noteMutation.isPending} onClick={() => noteMutation.mutate()}>
                Add
              </Button>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Evidence</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Vantage</TableHead>
                  <TableHead>Fidelity</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Hash</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {evidence.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      No evidence attached yet.
                    </TableCell>
                  </TableRow>
                )}
                {(evidence as EvidenceItem[]).map((item) => (
                  <EvidenceRow key={item.id} item={item} caseId={caseId} />
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Proposals</h3>
          <ProposalsSection caseId={caseId} proposals={proposals as ProposalItem[]} />
        </section>
      </div>
    </ScrollArea>
  );
}

function CasesPage() {
  const fetchCases = useServerFn(listCasesFn);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: cases, isLoading } = useQuery({
    queryKey: ["cases"],
    queryFn: () => fetchCases(),
  });

  const filtered = useMemo(() => {
    return (cases ?? []).filter(
      (c) => (severityFilter === "all" || c.severity === severityFilter) && (statusFilter === "all" || c.status === statusFilter),
    );
  }, [cases, severityFilter, statusFilter]);

  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Cases</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Case & evidence workspace with chain-of-custody and reviewed change proposals. Read-only towards the
            network — nothing here is ever executed automatically.
          </p>
        </div>
        <NewCaseDialog />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-96 shrink-0 border-r border-border">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {CASE_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {caseSeverityLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {CASE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {caseStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="h-[calc(100%-49px)]">
            {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading cases...</p>}
            {!isLoading && filtered.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No cases match these filters.</p>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                className={`block w-full border-b border-border px-4 py-3 text-left hover:bg-accent ${
                  selectedId === c.id ? "bg-accent" : ""
                }`}
                onClick={() => setSelectedId(c.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">
                    #{c.case_number} {c.title}
                  </p>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge variant={caseSeverityVariant(c.severity)}>{caseSeverityLabel(c.severity)}</Badge>
                  <Badge variant={caseStatusVariant(c.status)}>{caseStatusLabel(c.status)}</Badge>
                </div>
              </button>
            ))}
          </ScrollArea>
        </aside>
        {selectedId ? (
          <CaseDetailPane caseId={selectedId} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a case, or open a new one.
          </div>
        )}
      </div>
    </AppShell>
  );
}
