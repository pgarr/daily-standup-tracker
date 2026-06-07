import { createClient } from "@supabase/supabase-js";

// Fall back to well-known local Supabase CLI defaults (run `npx supabase status` to verify).
// Override any of these with TEST_SUPABASE_* env vars if your local instance differs.
export const SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? "http://127.0.0.1:54321";

export const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

// Traditional local Supabase CLI service_role JWT (signed with the default local secret).
// Run `npx supabase status` to confirm or override via TEST_SUPABASE_SERVICE_KEY.
export const SUPABASE_SERVICE_KEY =
  process.env.TEST_SUPABASE_SERVICE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hj04zWl196z2-SBc0";

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
