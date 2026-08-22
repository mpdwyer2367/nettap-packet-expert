import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { type DragEvent, useRef, useState } from "react";
import { BookOpen, FileUp, Loader2, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  deleteDocumentFn,
  getDocumentFn,
  ingestDocumentFn,
  listDocumentsFn,
  searchDocsFn,
} from "@/lib/documents.functions";
import {
  ACCEPTED_UPLOAD_ACCEPT,
  DOC_CLASSES,
  DOC_CLASS_LABELS,
  type DocumentSummary,
} from "@/lib/document-types";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "Documentation library — NetTAP AI" },
      {
        name: "description",
        content:
          "Upload, browse and semantically search NetTAP manuals, config guides, runbooks, release notes and design docs.",
      },
      { property: "og:title", content: "Documentation library — NetTAP AI" },
      {
        property: "og:description",
        content: "The RAG-indexed documentation library grounding NetTAP AI's answers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

const ROLE_OPTIONS = [
  { value: "user", label: "User" },
  { value: "moderator", label: "Moderator" },
  { value: "admin", label: "Admin" },
];

async function readFileText(file: File): Promise<string> {
  return file.text();
}

function LibraryPage() {
  const queryClient = useQueryClient();
  const listDocuments = useServerFn(listDocumentsFn);
  const getDocument = useServerFn(getDocumentFn);
  const ingestDocument = useServerFn(ingestDocumentFn);
  const removeDocument = useServerFn(deleteDocumentFn);
  const searchDocsRun = useServerFn(searchDocsFn);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [docClass, setDocClass] = useState<string>(DOC_CLASSES[0]!.value);
  const [product, setProduct] = useState("");
  const [version, setVersion] = useState("");
  const [tags, setTags] = useState("");
  const [minRole, setMinRole] = useState("user");
  const [stage, setStage] = useState("");

  const [filterText, setFilterText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchDocClass, setSearchDocClass] = useState("");
  const [searchResults, setSearchResults] = useState<
    Awaited<ReturnType<typeof searchDocsRun>> | null
  >(null);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments(),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["documents", "detail", selectedId],
    queryFn: () => getDocument({ data: { id: selectedId! } }),
    enabled: Boolean(selectedId),
  });

  function chooseFile(nextFile: File | null) {
    if (!nextFile) return;
    setFile(nextFile);
    if (!title.trim()) setTitle(nextFile.name.replace(/\.[^.]+$/, ""));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a documentation file first.");
      if (!title.trim()) throw new Error("Give this document a title.");
      setStage("Reading file...");
      const text = await readFileText(file);
      setStage("Chunking, embedding and indexing...");
      return ingestDocument({
        data: {
          title,
          doc_class: docClass,
          product: product.trim() || null,
          version: version.trim() || null,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          min_role: minRole,
          source_filename: file.name,
          text,
        },
      });
    },
    onSuccess: async (result) => {
      toast.success(`Indexed ${result.chunk_count} chunks (${result.char_count.toLocaleString()} chars).`);
      setFile(null);
      setTitle("");
      setProduct("");
      setVersion("");
      setTags("");
      setStage("");
      if (fileRef.current) fileRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error: Error) => {
      setStage("");
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeDocument({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document removed.");
      setSelectedId(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const searchMutation = useMutation({
    mutationFn: () =>
      searchDocsRun({
        data: {
          query: searchQuery,
          docClass: searchDocClass || null,
          limit: 8,
        },
      }),
    onSuccess: (results) => setSearchResults(results),
    onError: (error: Error) => toast.error(error.message),
  });

  const filteredDocuments = (documents ?? []).filter((doc: DocumentSummary) => {
    if (!filterText.trim()) return true;
    const haystack = `${doc.title} ${doc.product ?? ""} ${doc.version ?? ""} ${doc.tags.join(" ")}`.toLowerCase();
    return haystack.includes(filterText.trim().toLowerCase());
  });

  return (
    <AppShell>
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Documentation library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload NetTAP manuals, config guides, runbooks, release notes, defect notes and design
          docs. Everything is chunked, embedded and made available to NetTAP AI as citable
          evidence.
        </p>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-6">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold tracking-tight">Upload documentation</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="doc-file">Document file</Label>
                <div
                  className={`flex min-h-28 items-center justify-center border border-dashed px-4 py-5 transition-colors ${isDragging ? "border-primary bg-accent" : "border-input bg-background"}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <Input
                    id="doc-file"
                    type="file"
                    ref={fileRef}
                    accept={ACCEPTED_UPLOAD_ACCEPT}
                    className="sr-only"
                    onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                  />
                  {file ? (
                    <div className="flex w-full items-center gap-3">
                      <FileUp className="h-5 w-5 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(file.size / 1024).toFixed(1)} KB · ready to ingest
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove selected file"
                        onClick={() => {
                          setFile(null);
                          if (fileRef.current) fileRef.current.value = "";
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <FileUp className="mx-auto h-6 w-6 text-primary" />
                      <p className="mt-2 text-sm font-medium">Drop a documentation file here</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        .md, .txt, .csv, .json, .html — up to ~4 MB of text
                      </p>
                      <Button asChild type="button" size="sm" variant="outline" className="mt-3">
                        <label htmlFor="doc-file">Browse files</label>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-title">Title</Label>
                <Input
                  id="doc-title"
                  placeholder="NetTAP Broker Manual"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-class">Document class</Label>
                <select
                  id="doc-class"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={docClass}
                  onChange={(event) => setDocClass(event.target.value)}
                >
                  {DOC_CLASSES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  {DOC_CLASSES.find((option) => option.value === docClass)?.description}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-product">Product</Label>
                <Input
                  id="doc-product"
                  placeholder="NetTAP Broker"
                  value={product}
                  onChange={(event) => setProduct(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-version">Version</Label>
                <Input
                  id="doc-version"
                  placeholder="4.2"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-tags">Tags (comma separated)</Label>
                <Input
                  id="doc-tags"
                  placeholder="mirroring, filtering"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-role">Minimum role</Label>
                <select
                  id="doc-role"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={minRole}
                  onChange={(event) => setMinRole(event.target.value)}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending || !file}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="mr-2 h-4 w-4" />
                )}
                {uploadMutation.isPending ? stage || "Working..." : "Ingest and index"}
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold tracking-tight">Test retrieval</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Run a semantic search the way NetTAP AI would, and inspect the citations it would
              return.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input
                placeholder="How do I configure port mirroring?"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && searchQuery.trim()) searchMutation.mutate();
                }}
                className="flex-1"
              />
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={searchDocClass}
                onChange={(event) => setSearchDocClass(event.target.value)}
              >
                <option value="">All classes</option>
                {DOC_CLASSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Button
                onClick={() => searchMutation.mutate()}
                disabled={searchMutation.isPending || !searchQuery.trim()}
              >
                {searchMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search
              </Button>
            </div>
            {searchResults && (
              <div className="mt-4 space-y-3">
                {searchResults.length === 0 && (
                  <p className="text-sm text-muted-foreground">No matching chunks found.</p>
                )}
                {searchResults.map((hit) => (
                  <div key={hit.chunk_id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-mono text-primary">{hit.citation}</p>
                      <Badge variant="outline">{hit.similarity.toFixed(3)}</Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{hit.content}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold tracking-tight">Documents</h2>
              <Input
                placeholder="Filter by title, product, tag..."
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                className="max-w-xs"
              />
            </div>
            {isLoading && (
              <p className="px-5 py-6 text-sm text-muted-foreground">Loading documents...</p>
            )}
            {!isLoading && filteredDocuments.length === 0 && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Nothing ingested yet. Upload documentation above to begin.
              </p>
            )}
            <div className="divide-y divide-border">
              {filteredDocuments.map((doc) => (
                <div key={doc.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelectedId(doc.id)}
                  >
                    <p className="truncate text-sm font-medium">{doc.title}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {doc.product ?? "—"} {doc.version ? `v${doc.version}` : ""} ·{" "}
                      {doc.chunk_count} chunks · {doc.char_count.toLocaleString()} chars
                    </p>
                  </button>
                  <Badge variant="secondary">{DOC_CLASS_LABELS[doc.doc_class] ?? doc.doc_class}</Badge>
                  <span className="rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-primary">
                    {doc.status}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => deleteMutation.mutate(doc.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </ScrollArea>

      <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              {detail?.document.title ?? "Document"}
            </SheetTitle>
            <SheetDescription>
              {detail?.document.product ?? "—"} {detail?.document.version ? `v${detail.document.version}` : ""} ·{" "}
              {detail?.document.chunk_count ?? 0} chunks
            </SheetDescription>
          </SheetHeader>
          {detailLoading && <p className="mt-4 text-sm text-muted-foreground">Loading...</p>}
          {detail && (
            <div className="mt-4 space-y-3">
              {detail.chunks.map((chunk) => (
                <div key={chunk.id} className="rounded-md border border-border p-3">
                  <p className="text-xs font-mono text-muted-foreground">
                    #{chunk.chunk_index}
                    {chunk.section ? ` · § ${chunk.section}` : ""}
                    {typeof chunk.page === "number" ? ` · p.${chunk.page}` : ""}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{chunk.content}</p>
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
