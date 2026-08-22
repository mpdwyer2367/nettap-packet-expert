import { createMiddleware } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";

const REFRESH_SKEW_SECONDS = 60;

async function currentAccessToken(): Promise<string | undefined> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return undefined;

  const expiresAt = session.expires_at ?? 0;
  const expiringSoon = expiresAt > 0 && expiresAt - REFRESH_SKEW_SECONDS <= Math.floor(Date.now() / 1000);
  if (!expiringSoon) return session.access_token;

  const { data: refreshed } = await supabase.auth.refreshSession();
  return refreshed.session?.access_token ?? session.access_token;
}

function isUnauthorized(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Unauthorized");
}

async function bounceToSignIn() {
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  if (typeof window !== "undefined" && window.location.pathname !== "/auth") {
    window.location.assign("/auth");
  }
}

/**
 * Attaches a *fresh* Supabase bearer token to every server-function RPC.
 *
 * The generated attacher reads the cached session only, so a stale or expired
 * access token reaches `requireSupabaseAuth`, which throws a plain
 * `Unauthorized` error — surfacing as an opaque HTTP 500 and a blank screen.
 * Here we refresh proactively and, if the server still rejects the token, send
 * the user back to sign-in instead of crashing the route.
 */
export const attachSupabaseAuthFresh = createMiddleware({ type: "function" }).client(async ({ next }) => {
  let token: string | undefined;
  try {
    token = await currentAccessToken();
  } catch {
    token = undefined;
  }

  try {
    return await next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch (error) {
    if (isUnauthorized(error)) {
      await bounceToSignIn();
    }
    throw error;
  }
});
