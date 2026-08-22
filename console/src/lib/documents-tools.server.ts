import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { searchDocs } from "./documents.server";
import { listDocuments } from "./documents.server";

type Client = SupabaseClient<Database>;

/**
 * Documentation-library tools exposed to the model: semantic search over
 * ingested NetTAP docs, plus a library index so the model can say when a
 * question is not covered by the available documentation.
 */
export function createDocumentTools(supabase: Client, _userId: string) {
  return {
    search_nettap_docs: tool({
      description:
        "Semantic search over the ingested NetTAP documentation library (manuals, config guides, runbooks, release notes, defect notes, design docs). Returns ranked excerpts, each with a citation string and the document/chunk ids so the answer can cite precisely.",
      inputSchema: z.object({
        query: z.string(),
        doc_class: z.string().nullable(),
        product: z.string().nullable(),
        limit: z.number().nullable(),
      }),
      execute: async (input) => {
        const hits = await searchDocs(supabase, {
          query: input.query,
          docClass: input.doc_class,
          product: input.product,
          limit: input.limit ?? 8,
        });
        return {
          results: hits.map((hit) => ({
            document_id: hit.document_id,
            chunk_id: hit.chunk_id,
            citation: hit.citation,
            similarity: hit.similarity,
            excerpt: hit.content,
          })),
        };
      },
    }),

    list_nettap_docs: tool({
      description:
        "List what NetTAP documentation is available in the library: titles, class, product, version, tags and chunk counts. Call this to check coverage before claiming an answer is not documented.",
      inputSchema: z.object({}),
      execute: async () => {
        const documents = await listDocuments(supabase);
        return {
          documents: documents.map((doc) => ({
            id: doc.id,
            title: doc.title,
            doc_class: doc.doc_class,
            product: doc.product,
            version: doc.version,
            tags: doc.tags,
            chunk_count: doc.chunk_count,
            status: doc.status,
          })),
        };
      },
    }),
  };
}
