import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ReportPlaybookId } from "@/lib/report-playbooks";

export type ReportVisual =
  | { type: "chart"; title: string; chartType: string; points: { label: string; value: number }[] }
  | { type: "diagram"; title: string; mermaid: string };

export type ReportRecord = {
  id: string;
  title: string;
  markdown: string;
  visuals: ReportVisual[];
  investigation_id: string | null;
  dataset_id: string | null;
  source: string;
  playbook: string | null;
  status: string;
  created_at: string;
};

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReportRecord[]> => {
    const { data, error } = await context.supabase
      .from("reports")
      .select(
        "id, title, markdown, visuals, investigation_id, dataset_id, source, playbook, status, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      ...row,
      visuals: (row.visuals ?? []) as unknown as ReportVisual[],
    }));
  });

export const saveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      title: string;
      markdown: string;
      visuals: ReportVisual[];
      investigationId?: string | null;
      datasetId?: string | null;
    }) => {
      if (!input.markdown?.trim()) throw new Error("There is nothing to report on yet.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: saved, error } = await context.supabase
      .from("reports")
      .insert({
        user_id: context.userId,
        title: data.title.trim() || "Investigation report",
        markdown: data.markdown,
        visuals: data.visuals,
        investigation_id: data.investigationId ?? null,
        dataset_id: data.datasetId ?? null,
        source: "investigation",
        status: "ready",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: saved.id };
  });

export const deleteReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("reports").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { datasetId: string; playbook: ReportPlaybookId; title?: string | undefined }) => {
      if (!input.datasetId) throw new Error("A dataset is required.");
      if (!input.playbook) throw new Error("A playbook is required.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { runReportPlaybook } = await import("./report-playbooks.server");
    const result = await runReportPlaybook(context.supabase, data.datasetId, data.playbook);
    const title = data.title?.trim() || result.title;

    const { data: saved, error } = await context.supabase
      .from("reports")
      .insert({
        user_id: context.userId,
        title,
        markdown: result.markdown,
        visuals: result.visuals,
        dataset_id: data.datasetId,
        source: "playbook",
        playbook: data.playbook,
        status: "ready",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: saved.id };
  });
