import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DOC_CLASSES, MAX_DOCUMENT_TEXT_BYTES, type DocumentSummary } from "./document-types";

const DOC_CLASS_VALUES = new Set(DOC_CLASSES.map((entry) => entry.value));

export const listDocumentsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DocumentSummary[]> => {
    const { listDocuments } = await import("./documents.server");
    return listDocuments(context.supabase);
  });

export const getDocumentFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { getDocument } = await import("./documents.server");
    return getDocument(context.supabase, data.id);
  });

type IngestDocumentPayload = {
  title: string;
  doc_class: string;
  product?: string | null;
  version?: string | null;
  tags?: string[];
  min_role?: string;
  source_filename?: string | null;
  text: string;
};

export const ingestDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: IngestDocumentPayload) => {
    if (!input?.title?.trim()) throw new Error("A document title is required.");
    if (!input?.doc_class || !DOC_CLASS_VALUES.has(input.doc_class as never)) {
      throw new Error("Choose a valid document class.");
    }
    if (!input?.text?.trim()) throw new Error("The document appears to be empty.");
    if (new TextEncoder().encode(input.text).length > MAX_DOCUMENT_TEXT_BYTES) {
      throw new Error("This document's text is too large (limit ~4 MB).");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { ingestDocument } = await import("./documents.server");
    return ingestDocument(context.supabase, context.userId, data);
  });

export const deleteDocumentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { deleteDocument } = await import("./documents.server");
    return deleteDocument(context.supabase, data.id);
  });

type SearchDocsPayload = {
  query: string;
  docClass?: string | null;
  product?: string | null;
  limit?: number;
};

export const searchDocsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: SearchDocsPayload) => {
    if (!input?.query?.trim()) throw new Error("Enter a search query.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { searchDocs } = await import("./documents.server");
    return searchDocs(context.supabase, data);
  });
