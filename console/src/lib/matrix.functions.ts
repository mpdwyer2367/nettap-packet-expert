import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MatrixMode } from "./matrix-types";

export const listMatrixConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadMatrixOverview } = await import("./matrix.server");
    return loadMatrixOverview(context.supabase, context.userId);
  });

export const createMatrixConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      name: string;
      site?: string | null;
      mode: MatrixMode;
      base_url?: string | null;
      secret_name?: string | null;
      verify_tls?: boolean;
      poll_interval_seconds?: number;
    }) => {
      const name = String(input?.name ?? "").trim();
      if (!name) throw new Error("Give the connection a name.");
      const mode: MatrixMode = input.mode === "live" ? "live" : "simulator";
      if (mode === "live" && !input.base_url) throw new Error("A base URL is required for a live connection.");
      return {
        name: name.slice(0, 120),
        site: (input.site ?? "default").slice(0, 80),
        mode,
        base_url: input.base_url ? input.base_url.slice(0, 300) : null,
        secret_name: input.secret_name ? input.secret_name.slice(0, 120) : null,
        verify_tls: input.verify_tls !== false,
        poll_interval_seconds: Math.min(Math.max(Math.round(Number(input.poll_interval_seconds) || 60), 15), 3600),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { createConnection } = await import("./matrix.server");
    return createConnection(context.supabase, context.userId, data);
  });

export const updateMatrixConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id: string;
      name?: string;
      site?: string;
      mode?: MatrixMode;
      base_url?: string | null;
      secret_name?: string | null;
      verify_tls?: boolean;
      poll_interval_seconds?: number;
    }) => {
      if (!input?.id) throw new Error("A connection id is required.");
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name.slice(0, 120);
      if (input.site !== undefined) patch.site = input.site.slice(0, 80);
      if (input.mode !== undefined) patch.mode = input.mode === "live" ? "live" : "simulator";
      if (input.base_url !== undefined) patch.base_url = input.base_url;
      if (input.secret_name !== undefined) patch.secret_name = input.secret_name;
      if (input.verify_tls !== undefined) patch.verify_tls = Boolean(input.verify_tls);
      if (input.poll_interval_seconds !== undefined)
        patch.poll_interval_seconds = Math.min(Math.max(Math.round(Number(input.poll_interval_seconds)), 15), 3600);
      return { id: input.id, patch };
    },
  )
  .handler(async ({ data, context }) => {
    const { updateConnection } = await import("./matrix.server");
    return updateConnection(context.supabase, context.userId, data.id, data.patch as never);
  });

export const deleteMatrixConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (!input?.id) throw new Error("A connection id is required.");
    return { id: input.id };
  })
  .handler(async ({ data, context }) => {
    const { deleteConnection } = await import("./matrix.server");
    return deleteConnection(context.supabase, context.userId, data.id);
  });

export const syncMatrixConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (!input?.id) throw new Error("A connection id is required.");
    return { id: input.id };
  })
  .handler(async ({ data, context }) => {
    const { syncMatrixConnection } = await import("./matrix.server");
    return syncMatrixConnection(context.supabase, context.userId, data.id);
  });

export const getMatrixTopology = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { connectionId: string }) => {
    if (!input?.connectionId) throw new Error("A connection id is required.");
    return { connectionId: input.connectionId };
  })
  .handler(async ({ data, context }) => {
    const { loadTopology, loadAlarms, loadPolicies, loadConfigRevisions } = await import("./matrix.server");
    const [topology, alarms, policies, revisions] = await Promise.all([
      loadTopology(context.supabase, context.userId, data.connectionId),
      loadAlarms(context.supabase, context.userId, data.connectionId),
      loadPolicies(context.supabase, context.userId, data.connectionId),
      loadConfigRevisions(context.supabase, context.userId, data.connectionId),
    ]);
    return { topology, alarms, policies, revisions };
  });

export const getMatrixPortCounters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { connectionId: string; portId: string; minutes?: number }) => {
    if (!input?.connectionId) throw new Error("A connection id is required.");
    if (!input?.portId) throw new Error("A port id is required.");
    return {
      connectionId: input.connectionId,
      portId: input.portId,
      minutes: Math.min(Math.max(Math.round(Number(input.minutes) || 60), 5), 1440),
    };
  })
  .handler(async ({ data, context }) => {
    const { loadPortCounters } = await import("./matrix.server");
    return loadPortCounters(context.supabase, context.userId, data.connectionId, data.portId, data.minutes);
  });

export const getMatrixPolicyDiff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { connectionId: string; fromRevision: number; toRevision: number }) => {
    if (!input?.connectionId) throw new Error("A connection id is required.");
    return {
      connectionId: input.connectionId,
      fromRevision: Math.trunc(Number(input.fromRevision) || 0),
      toRevision: Math.trunc(Number(input.toRevision) || 0),
    };
  })
  .handler(async ({ data, context }) => {
    const { loadPolicyDiff } = await import("./matrix.server");
    return loadPolicyDiff(context.supabase, context.userId, data.connectionId, data.fromRevision, data.toRevision);
  });
