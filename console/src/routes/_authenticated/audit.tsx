import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listAuditEvents } from "@/lib/cases.functions";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit log — NetTAP AI" },
      {
        name: "description",
        content: "Append-only audit log of every case, evidence and governance action taken in NetTAP AI.",
      },
      { property: "og:title", content: "Audit log — NetTAP AI" },
      {
        property: "og:description",
        content: "Filterable, paged record of who did what, when, and the outcome — nothing is ever edited or deleted.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditPage,
});

function outcomeVariant(outcome: string): "default" | "secondary" | "destructive" | "outline" {
  if (outcome === "success") return "outline";
  if (outcome === "error" || outcome === "failure") return "destructive";
  return "secondary";
}

function AuditPage() {
  const fetchEvents = useServerFn(listAuditEvents);
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState<string>("all");
  const [outcome, setOutcome] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ["audit-events", page, category, outcome],
    queryFn: () =>
      fetchEvents({
        data: {
          page,
          pageSize,
          category: category === "all" ? null : category,
          outcome: outcome === "all" ? null : outcome,
        },
      }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <AppShell>
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only record of case, evidence and governance actions. Entries are never edited or deleted.
        </p>
      </header>

      <div className="flex items-center gap-2 border-b border-border px-6 py-2.5">
        <Select value={category} onValueChange={(v) => { setCategory(v); setPage(0); }}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="case">Case</SelectItem>
            <SelectItem value="evidence">Evidence</SelectItem>
            <SelectItem value="governance">Governance</SelectItem>
          </SelectContent>
        </Select>
        <Select value={outcome} onValueChange={(v) => { setOutcome(v); setPage(0); }}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-6 py-4">
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      No audit events match these filters.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row) => (
                  <>
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {row.created_at.slice(0, 19).replace("T", " ")}
                      </TableCell>
                      <TableCell className="text-xs">{row.actor ?? "system"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {row.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.action}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                        {row.target ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={outcomeVariant(row.outcome)} className="capitalize">
                          {row.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Toggle detail"
                          onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                        >
                          {expandedId === row.id ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedId === row.id && (
                      <TableRow key={`${row.id}-detail`}>
                        <TableCell colSpan={7} className="bg-muted/30">
                          <pre className="overflow-x-auto whitespace-pre-wrap py-2 font-mono text-[11px] text-muted-foreground">
                            {JSON.stringify(row.detail ?? {}, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {page + 1} of {totalPages} · {total} events
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(p - 1, 0))}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => Math.min(p + 1, totalPages - 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </AppShell>
  );
}
