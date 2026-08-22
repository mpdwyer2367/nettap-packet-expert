import type { SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Case & governance tools exposed to the model. Release 1 is read-only towards
 * the network: `propose_change` only ever records a recommendation for a human
 * to review — nothing here pushes configuration to any device or broker.
 */
export function createCaseTools(supabase: Client, userId: string) {
  return {
    case_open: tool({
      description:
        "Open a new case for the current investigation, or reuse an existing one, so evidence and findings can be attached. Returns the case id and case number.",
      inputSchema: z.object({
        title: z.string(),
        summary: z.string().nullable(),
        severity: z.enum(["low", "medium", "high", "critical"]).nullable(),
        investigationId: z.string().nullable(),
        datasetId: z.string().nullable(),
        existingCaseId: z.string().nullable(),
      }),
      execute: async (input) => {
        const { createCase, getCaseDetail } = await import("./cases.server");
        if (input.existingCaseId) {
          const detail = await getCaseDetail(supabase, input.existingCaseId);
          if (detail) {
            return {
              case_id: detail.caseRow.id,
              case_number: detail.caseRow.case_number,
              title: detail.caseRow.title,
              status: detail.caseRow.status,
              reused: true,
            };
          }
        }
        const row = await createCase(supabase, userId, {
          title: input.title,
          summary: input.summary,
          severity: input.severity ?? "medium",
          investigationId: input.investigationId,
          datasetId: input.datasetId,
        });
        return { case_id: row.id, case_number: row.case_number, title: row.title, status: row.status, reused: false };
      },
    }),

    case_add_evidence: tool({
      description:
        "Attach a citable piece of evidence to a case — telemetry record ids, a document chunk, or a chart/note payload — with provenance (source, vantage, fidelity tier, time window). Computes a content hash and records it in the chain of custody. Returns the evidence id and hash.",
      inputSchema: z.object({
        caseId: z.string(),
        label: z.string(),
        evidenceKind: z.enum(["flow", "packet", "log", "snmp", "wmi", "matrix", "doc", "chart", "note"]),
        datasetId: z.string().nullable(),
        recordIds: z.array(z.number()).nullable(),
        documentId: z.string().nullable(),
        chunkId: z.string().nullable(),
        connectionId: z.string().nullable(),
        payload: z.record(z.string(), z.unknown()).nullable(),
        source: z.string().nullable(),
        vantage: z.string().nullable(),
        fidelityTier: z.string().nullable(),
        windowStart: z.string().nullable(),
        windowEnd: z.string().nullable(),
      }),
      execute: async (input) => {
        const { addCaseEvidence } = await import("./cases.server");
        const row = await addCaseEvidence(supabase, userId, {
          caseId: input.caseId,
          label: input.label,
          evidenceKind: input.evidenceKind,
          datasetId: input.datasetId,
          recordIds: input.recordIds ?? [],
          documentId: input.documentId,
          chunkId: input.chunkId,
          connectionId: input.connectionId,
          payload: input.payload ?? {},
          source: input.source,
          vantage: input.vantage,
          fidelityTier: input.fidelityTier,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
        });
        return { evidence_id: row.id, content_hash: row.contentHash, label: row.label };
      },
    }),

    case_timeline: tool({
      description:
        "Read a case's append-only timeline and its attached evidence list, for status checks and report writing.",
      inputSchema: z.object({ caseId: z.string() }),
      execute: async (input) => {
        const { getCaseDetail } = await import("./cases.server");
        const detail = await getCaseDetail(supabase, input.caseId);
        if (!detail) return { error: "Case not found." };
        return {
          case: {
            id: detail.caseRow.id,
            case_number: detail.caseRow.case_number,
            title: detail.caseRow.title,
            status: detail.caseRow.status,
            severity: detail.caseRow.severity,
          },
          timeline: (detail.events as Array<{ created_at: string; kind: string; actor: string | null; body: string }>).map(
            (e) => ({ ts: e.created_at, kind: e.kind, actor: e.actor, body: e.body }),
          ),
          evidence: detail.evidence.map((e) => ({
            id: e.id,
            label: e.label,
            evidence_kind: e.evidence_kind,
            source: e.source,
            content_hash: e.content_hash,
          })),
        };
      },
    }),

    propose_change: tool({
      description:
        "Record a recommended MATRIX/broker configuration change with rationale, target, risk and rollback notes, for a human reviewer to accept, reject or defer. This is recorded for human review only and is NEVER executed or pushed to any device automatically.",
      inputSchema: z.object({
        caseId: z.string(),
        connectionId: z.string().nullable(),
        title: z.string(),
        rationale: z.string(),
        target: z.string().nullable(),
        changeKind: z.string().nullable(),
        proposedChange: z.record(z.string(), z.unknown()).nullable(),
        risk: z.enum(["low", "medium", "high"]).nullable(),
        rollback: z.string().nullable(),
      }),
      execute: async (input) => {
        const { createProposal } = await import("./cases.server");
        const row = await createProposal(supabase, userId, {
          caseId: input.caseId,
          connectionId: input.connectionId,
          title: input.title,
          rationale: input.rationale,
          target: input.target,
          changeKind: input.changeKind ?? "config",
          proposedChange: { ...(input.proposedChange ?? {}), rollback: input.rollback ?? null },
          risk: input.risk ?? "medium",
        });
        return {
          proposal_id: row.id,
          status: row.status,
          note: "Recorded for human review only — no change was applied to any device or broker.",
        };
      },
    }),
  };
}
