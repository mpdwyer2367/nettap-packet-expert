import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TelemetryToolInput = {
  datasetId: string;
  tool: string;
  args?: Record<string, unknown>;
};

/**
 * Executes one telemetry tool server-side (RLS scoped to the caller).
 * Used by the browser-side Ollama loop, which runs the model locally but must
 * not touch the database directly.
 */
export const runTelemetryTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: TelemetryToolInput) => {
    if (!input?.datasetId) throw new Error("datasetId is required");
    if (!input?.tool) throw new Error("tool is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ result: string }> => {
    const { data: dataset, error } = await context.supabase
      .from("datasets")
      .select("id")
      .eq("id", data.datasetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!dataset) throw new Error("Dataset not found");

    const { createTelemetryTools } = await import("./telemetry-tools.server");
    const tools = createTelemetryTools(
      context.supabase,
      data.datasetId,
    ) as unknown as Record<
      string,
      { execute?: (input: unknown, options: unknown) => Promise<unknown> }
    >;

    const tool = tools[data.tool];
    if (!tool?.execute) throw new Error(`Unknown tool: ${data.tool}`);

    const result = await tool.execute(data.args ?? {}, {
      toolCallId: `local-${Date.now()}`,
      messages: [],
    });
    // Serialized as JSON so the server-function boundary stays structurally typed.
    return { result: JSON.stringify(result ?? null) };
  });
