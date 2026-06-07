import { createClient } from "@supabase/supabase-js";

// Fall back to well-known local Supabase CLI defaults (run `npx supabase status` to verify).
// Override any of these with TEST_SUPABASE_* env vars if your local instance differs.
export const SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? "http://127.0.0.1:54321";

export const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

// Local Supabase CLI secret key (run `npx supabase status` to confirm for your instance).
// Override via TEST_SUPABASE_SERVICE_KEY if your local key differs.
export const SUPABASE_SERVICE_KEY =
  process.env.TEST_SUPABASE_SERVICE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

/** Probe the local REST API. Returns false (never throws) on any connection failure. */
export async function isSupabaseRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Bypasses RLS. Use ONLY for fixture setup and teardown in beforeAll/afterAll.
 * Never use this client in test assertions — results will not reflect real RLS behaviour.
 */
export function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

/**
 * Enforces RLS via the user's JWT. Use this for ALL test assertions.
 * The accessToken comes from signInWithPassword on a fixture user.
 */
export function createUserClient(accessToken: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: "Bearer " + accessToken } },
  });
}
