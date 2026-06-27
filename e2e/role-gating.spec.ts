import { test, expect, request } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import { isSupabaseRunning } from "../src/__tests__/helpers/supabase-test";
import { FIXTURES_PATH } from "./global-setup";

// Pessimistic default — flipped to false in beforeAll when conditions are met.
// Avoids top-level await (CommonJS Playwright env) and test.describe.configure({ mode: 'skip' })
// which is not a valid Playwright API (only 'default'|'parallel'|'serial' are valid modes).
let shouldSkip = true;
let teamLeadCtx: Awaited<ReturnType<typeof request.newContext>> | undefined;
let memberCtx: Awaited<ReturnType<typeof request.newContext>> | undefined;

test.describe("team-feed role gating (requires local Supabase + npm run dev with Supabase vars)", () => {
  test.beforeAll(async () => {
    if (!existsSync(FIXTURES_PATH) || !(await isSupabaseRunning())) {
      return;
    }
    shouldSkip = false;
    const { teamLead, member } = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8")) as {
      teamLead: { email: string; password: string };
      member: { email: string; password: string };
    };

    // Astro 5 security.checkOrigin (enabled by default) rejects POST requests
    // without an Origin header. Non-browser Playwright contexts must supply it.
    const signinHeaders = { Origin: "http://localhost:4321" };

    teamLeadCtx = await request.newContext({ baseURL: "http://localhost:4321" });
    await teamLeadCtx.post("/api/auth/signin", {
      form: { email: teamLead.email, password: teamLead.password },
      headers: signinHeaders,
    });

    memberCtx = await request.newContext({ baseURL: "http://localhost:4321" });
    await memberCtx.post("/api/auth/signin", {
      form: { email: member.email, password: member.password },
      headers: signinHeaders,
    });
  });

  test.afterAll(async () => {
    await teamLeadCtx?.dispose();
    await memberCtx?.dispose();
  });

  test("member session is redirected to /dashboard", async () => {
    test.skip(shouldSkip, "Requires local Supabase + fixtures (run npx supabase start first)");
    const resp = await memberCtx.get("/team-feed", { maxRedirects: 0 });
    expect(resp.status()).toBe(302);
    expect(resp.headers().location).toBe("/dashboard");
  });

  test("team_lead session reaches /team-feed (200)", async () => {
    test.skip(shouldSkip, "Requires local Supabase + fixtures (run npx supabase start first)");
    const resp = await teamLeadCtx.get("/team-feed", { maxRedirects: 0 });
    expect(resp.status()).toBe(200);
  });
});
