import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { chunkText } from "./document-chunk";
import { formatCitation, type DocumentChunkHit, type DocumentSummary } from "./document-types";
import { embedTexts } from "./local-embeddings.server";

type Client = SupabaseClient<Database>;

export type IngestDocumentInput = {
  title: string;
  doc_class: string;
  product?: string | null;
  version?: string | null;
  tags?: string[];
  min_role?: string;
  source_filename?: string | null;
  text: string;
};

export type IngestDocumentResult = {
  id: string;
  chunk_count: number;
  char_count: number;
};

/**
 * Chunks, embeds and stores a documentation upload. Rolls back the document
 * row if chunking/embedding/insert fails partway through.
 */
export async function ingestDocument(
  supabase: Client,
  userId: string,
  input: IngestDocumentInput,
): Promise<IngestDocumentResult> {
  const chunks = chunkText(input.text);
  if (chunks.length === 0) throw new Error("No readable text could be extracted from this document.");

  const { data: document, error: documentError } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      title: input.title.trim(),
      doc_class: input.doc_class,
      product: input.product?.trim() || null,
      version: input.version?.trim() || null,
      tags: input.tags ?? [],
      min_role: (input.min_role ?? "user") as never,
      source_filename: input.source_filename ?? null,
      status: "indexing",
      char_count: input.text.length,
    })
    .select("id")
    .single();
  if (documentError || !document) {
    throw new Error(documentError?.message ?? "Failed to create document.");
  }

  const documentId = document.id as string;

  try {
    const vectors = await embedTexts(
      chunks.map((chunk) => chunk.content),
    );

    const rows = chunks.map((chunk, index) => ({
      user_id: userId,
      document_id: documentId,
      chunk_index: index,
      section: chunk.section,
      page: chunk.page,
      anchor: chunk.anchor,
      content: chunk.content,
      embedding: vectors[index]?.length ? JSON.stringify(vectors[index]) : null,
    }));

    for (let index = 0; index < rows.length; index += 100) {
      const { error } = await supabase.from("document_chunks").insert(rows.slice(index, index + 100));
      if (error) throw new Error(`Failed to store chunks: ${error.message}`);
    }

    const { error: updateError } = await supabase
      .from("documents")
      .update({ status: "ready", chunk_count: rows.length, char_count: input.text.length })
      .eq("id", documentId);
    if (updateError) throw new Error(updateError.message);

    return { id: documentId, chunk_count: rows.length, char_count: input.text.length };
  } catch (error) {
    await supabase.from("documents").delete().eq("id", documentId);
    throw error instanceof Error ? error : new Error("Failed to ingest document.");
  }
}

export async function listDocuments(supabase: Client): Promise<DocumentSummary[]> {
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, title, doc_class, product, version, source_filename, tags, min_role, chunk_count, char_count, status, notes, created_at, updated_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DocumentSummary[];
}

export async function getDocument(supabase: Client, id: string) {
  const { data: document, error } = await supabase
    .from("documents")
    .select(
      "id, title, doc_class, product, version, source_filename, tags, min_role, chunk_count, char_count, status, notes, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!document) throw new Error("Document not found.");

  const { data: chunks, error: chunksError } = await supabase
    .from("document_chunks")
    .select("id, chunk_index, section, page, anchor, content")
    .eq("document_id", id)
    .order("chunk_index", { ascending: true });
  if (chunksError) throw new Error(chunksError.message);

  return { document: document as unknown as DocumentSummary, chunks: chunks ?? [] };
}

export async function deleteDocument(supabase: Client, id: string) {
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export type SearchDocsInput = {
  query: string;
  docClass?: string | null;
  product?: string | null;
  limit?: number;
};

export async function searchDocs(
  supabase: Client,
  input: SearchDocsInput,
): Promise<DocumentChunkHit[]> {
  const [embedding] = await embedTexts([input.query]);
  if (!embedding) return [];

  const rpcArgs: { query_embedding: string; match_count: number; filter_doc_class?: string } = {
    query_embedding: JSON.stringify(embedding),
    match_count: Math.min(Math.max(input.limit ?? 8, 1), 30),
  };
  if (input.docClass) rpcArgs.filter_doc_class = input.docClass;
  const { data, error } = await supabase.rpc("match_document_chunks", rpcArgs);
  if (error) throw new Error(`Document search failed: ${error.message}`);

  const rows = (data ?? []).filter(
    (row) => !input.product || row.product === input.product,
  );

  return rows.map((row) => ({
    chunk_id: row.chunk_id,
    document_id: row.document_id,
    title: row.title,
    doc_class: row.doc_class,
    product: row.product,
    version: row.version,
    section: row.section,
    page: row.page,
    anchor: row.anchor,
    content: row.content,
    similarity: Number(row.similarity.toFixed(3)),
    citation: formatCitation({
      title: row.title,
      version: row.version,
      section: row.section,
      page: row.page,
    }),
  }));
}
