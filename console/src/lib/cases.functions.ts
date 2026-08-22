import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAuditEvent } from "./governance.server";

export const listCasesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listCases } = await import("./cases.server");
    return listCases(context.supabase);
  });

export const getCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { getCaseDetail } = await import("./cases.server");
    return getCaseDetail(context.supabase, data.id);
  });

export const createCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      title: string;
      summary?: string | null;
      severity?: string;
      status?: string;
      owner?: string | null;
      sites?: string[];
      devices?: string[];
      investigationId?: string | null;
      datasetId?: string | null;
    }) => {
      if (!input.title?.trim()) throw new Error("A case title is required.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { createCase: create } = await import("./cases.server");
    const row = await create(context.supabase, context.userId, data);
    await recordAuditEvent(context.supabase, context.userId, {
      category: "case",
      action: "case.create",
      target: row.id,
      detail: { title: row.title },
    });
    return row;
  });

export const updateCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id: string;
      title?: string;
      summary?: string | null;
      severity?: string;
      status?: string;
      owner?: string | null;
      sites?: string[];
      devices?: string[];
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { updateCase: update } = await import("./cases.server");
    const row = await update(context.supabase, context.userId, data);
    await recordAuditEvent(context.supabase, context.userId, {
      category: "case",
      action: "case.update",
      target: row.id,
      detail: { fields: Object.keys(data).filter((k) => k !== "id") },
    });
    return row;
  });

export const addCaseEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { caseId: string; kind: string; body: string; extra?: Record<string, unknown> }) => {
    if (!input.body?.trim()) throw new Error("Event body is required.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { appendCaseEvent } = await import("./cases.server");
    const row = await appendCaseEvent(context.supabase, context.userId, data);
    await recordAuditEvent(context.supabase, context.userId, {
      category: "case",
      action: "case.event",
      target: data.caseId,
      detail: { kind: data.kind },
    });
    return row;
  });

export const addCaseEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      caseId: string;
      label: string;
      evidenceKind: string;
      datasetId?: string | null;
      recordIds?: number[];
      documentId?: string | null;
      chunkId?: string | null;
      connectionId?: string | null;
      payload?: Record<string, unknown>;
      source?: string | null;
      vantage?: string | null;
      fidelityTier?: string | null;
      windowStart?: string | null;
      windowEnd?: string | null;
    }) => {
      if (!input.label?.trim()) throw new Error("Evidence label is required.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { addCaseEvidence: add } = await import("./cases.server");
    const row = await add(context.supabase, context.userId, data);
    await recordAuditEvent(context.supabase, context.userId, {
      category: "evidence",
      action: "evidence.add",
      target: row.id,
      detail: { case_id: data.caseId, evidence_kind: data.evidenceKind, content_hash: row.contentHash },
    });
    return row;
  });

export const deleteCaseEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; caseId: string }) => input)
  .handler(async ({ data, context }) => {
    const { deleteCaseEvidence: remove } = await import("./cases.server");
    await remove(context.supabase, context.userId, data.id, data.caseId);
    await recordAuditEvent(context.supabase, context.userId, {
      category: "evidence",
      action: "evidence.delete",
      target: data.id,
      detail: { case_id: data.caseId },
    });
    return { ok: true };
  });

export const exportCaseMarkdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { exportCaseMarkdown: exportMd } = await import("./cases.server");
    const markdown = await exportMd(context.supabase, context.userId, data.id);
    await recordAuditEvent(context.supabase, context.userId, {
      category: "case",
      action: "case.export",
      target: data.id,
    });
    return { markdown };
  });

export const createProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      caseId: string;
      connectionId?: string | null;
      title: string;
      rationale: string;
      target?: string | null;
      changeKind?: string;
      proposedChange?: Record<string, unknown>;
      risk?: string;
    }) => {
      if (!input.title?.trim() || !input.rationale?.trim()) {
        throw new Error("A title and rationale are required.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { createProposal: create } = await import("./cases.server");
    const row = await create(context.supabase, context.userId, data);
    await recordAuditEvent(context.supabase, context.userId, {
      category: "governance",
      action: "proposal.create",
      target: row.id,
      detail: { case_id: data.caseId, risk: row.risk },
    });
    return row;
  });

export const reviewProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; caseId: string; status: string; reviewerNote?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const { reviewProposal: review } = await import("./cases.server");
    const row = await review(context.supabase, context.userId, data);
    await recordAuditEvent(context.supabase, context.userId, {
      category: "governance",
      action: "proposal.review",
      target: row.id,
      detail: { status: data.status },
    });
    return row;
  });

export const listAuditEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { page?: number; pageSize?: number; category?: string | null; outcome?: string | null }) => input ?? {},
  )
  .handler(async ({ data, context }) => {
    const page = Math.max(data.page ?? 0, 0);
    const pageSize = Math.min(Math.max(data.pageSize ?? 25, 1), 100);
    let query = context.supabase
      .from("audit_events")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (data.category) query = query.eq("category", data.category);
    if (data.outcome) query = query.eq("outcome", data.outcome);
    const { data: rows, error, count } = await query;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, page, pageSize };
  });
