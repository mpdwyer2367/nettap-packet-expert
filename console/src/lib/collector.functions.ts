import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeConfig } from "./collector-types";
import { normalizeLimits } from "./capacity";
import type { CapacityLimits } from "./capacity";
import type {
  ApplianceOverview,
  CollectorConfig,
  CollectorOs,
  MetricPoint,
} from "./collector-types";

export const getApplianceOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApplianceOverview> => {
    const { loadApplianceOverview, reconcileStaleCollectors } = await import("./collector.server");
    await reconcileStaleCollectors(context.supabase, context.userId);
    return loadApplianceOverview(context.supabase, context.userId);
  });

export const getInterfaceMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { collectorId: string; interfaceName: string; minutes?: number }) => {
    if (!input?.collectorId) throw new Error("A collector is required.");
    if (!input?.interfaceName) throw new Error("An interface is required.");
    const minutes = Math.min(Math.max(Math.round(Number(input.minutes) || 15), 1), 1440);
    return { collectorId: input.collectorId, interfaceName: input.interfaceName, minutes };
  })
  .handler(async ({ data, context }): Promise<MetricPoint[]> => {
    const { loadInterfaceMetrics } = await import("./collector.server");
    return loadInterfaceMetrics(context.supabase, context.userId, data);
  });

export const registerCollector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { name: string; os: CollectorOs }) => {
    const name = String(input?.name ?? "").trim();
    if (!name) throw new Error("Give the appliance a name.");
    const os: CollectorOs =
      input.os === "windows" || input.os === "macos" ? input.os : "linux";
    return { name: name.slice(0, 120), os };
  })
  .handler(async ({ data, context }) => {
    const { createCollector } = await import("./collector.server");
    return createCollector(context.supabase, context.userId, data);
  });

export const rotateCollectorTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (!input?.id) throw new Error("A collector id is required.");
    return { id: input.id };
  })
  .handler(async ({ data, context }) => {
    const { rotateCollectorToken } = await import("./collector.server");
    return rotateCollectorToken(context.supabase, data.id);
  });

export const updateCollectorConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; config: CollectorConfig }) => {
    if (!input?.id) throw new Error("A collector id is required.");
    return { id: input.id, config: normalizeConfig(input.config) };
  })
  .handler(async ({ data, context }) => {
    const { saveCollectorConfig } = await import("./collector.server");
    return saveCollectorConfig(context.supabase, data.id, data.config);
  });

/**
 * Publishes new ingestion ceilings to an appliance. Validation runs server-side
 * against the resources the appliance last reported, so a limit the VM cannot
 * honor is rejected before it becomes the running config.
 */
export const updateCollectorCapacity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; limits: CapacityLimits }) => {
    if (!input?.id) throw new Error("A collector id is required.");
    return { id: input.id, limits: normalizeLimits(input.limits) };
  })
  .handler(async ({ data, context }) => {
    const { saveCollectorCapacity } = await import("./collector.server");
    return saveCollectorCapacity(context.supabase, data.id, data.limits);
  });

export const removeCollector = createServerFn({ method: "POST" })

  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (!input?.id) throw new Error("A collector id is required.");
    return { id: input.id };
  })
  .handler(async ({ data, context }) => {
    const { deleteCollector } = await import("./collector.server");
    return deleteCollector(context.supabase, data.id);
  });
