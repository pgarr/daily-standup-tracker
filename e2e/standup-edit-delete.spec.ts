import { test, expect, request } from "@playwright/test";
import { isSupabaseRunning, createServiceClient } from "../src/__tests__/helpers/supabase-test";

// Pessimistic default — flipped to false in beforeAll when conditions are met.
let shouldSkip = true;
let memberCtx: Awaited<ReturnType<typeof request.newContext>> | undefined;
let otherCtx: Awaited<ReturnType<typeof request.newContext>> | undefined;

let memberId = "";
let otherMemberId = "";
let workspaceId = "";
let entryId = "";

const ts = Date.now();
const MEMBER_EMAIL = `edit-delete-member-${ts}@example.com`;
const OTHER_MEMBER_EMAIL = `edit-delete-other-${ts}@example.com`;
const PASSWORD = "test-password-123";
const ORIGIN = "http://localhost:4321";

function getCtx() {
  if (!memberCtx) throw new Error("memberCtx not initialized");
  return memberCtx;
}

function getOtherCtx() {
  if (!otherCtx) throw new Error("otherCtx not initialized");
  return otherCtx;
}

test.describe.serial("standup edit/delete API (requires local Supabase + npm run dev)", () => {
  test.beforeAll(async () => {
    if (!(await isSupabaseRunning())) return;
    shouldSkip = false;

    const svc = createServiceClient();

    // Create primary member user
    const { data: authMember, error: errMember } = await svc.auth.admin.createUser({
      email: MEMBER_EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (!authMember.user) throw new Error(`createUser member: ${errMember?.message ?? "unknown"}`);
    memberId = authMember.user.id;

    // Create workspace
    workspaceId = crypto.randomUUID();
    const { error: wsErr } = await svc.from("workspace").insert({ id: workspaceId, name: `edit-delete-${ts}` });
    if (wsErr) throw new Error(`workspace insert: ${wsErr.message}`);

    // Insert workspace_member for primary user
    const { error: wmErr } = await svc
      .from("workspace_member")
      .insert({ workspace_id: workspaceId, user_id: memberId, role: "member" });
    if (wmErr) throw new Error(`workspace_member insert: ${wmErr.message}`);

    // Sign in as primary member to get a session cookie
    memberCtx = await request.newContext({ baseURL: ORIGIN });
    await memberCtx.post("/api/auth/signin", {
      form: { email: MEMBER_EMAIL, password: PASSWORD },
      headers: { Origin: ORIGIN },
    });

    // Insert a standup entry directly via service client (isolated from submit API).
    // Generate the UUID here so we don't need to read it back (avoids any-typed .single()).
    entryId = crypto.randomUUID();
    const { error: entryErr } = await svc.from("standup_entries").insert({
      id: entryId,
      workspace_id: workspaceId,
      user_id: memberId,
      submitted_date: "2020-01-01",
      did: "original did",
      plan: "original plan",
      blockers: "original blocker",
    });
    if (entryErr) throw new Error(`standup entry insert: ${entryErr.message}`);

    // Create second user in the same workspace for ownership isolation test
    const { data: authOther, error: errOther } = await svc.auth.admin.createUser({
      email: OTHER_MEMBER_EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (!authOther.user) throw new Error(`createUser other: ${errOther?.message ?? "unknown"}`);
    otherMemberId = authOther.user.id;

    const { error: wm2Err } = await svc
      .from("workspace_member")
      .insert({ workspace_id: workspaceId, user_id: otherMemberId, role: "member" });
    if (wm2Err) throw new Error(`workspace_member insert (other): ${wm2Err.message}`);

    otherCtx = await request.newContext({ baseURL: ORIGIN });
    await otherCtx.post("/api/auth/signin", {
      form: { email: OTHER_MEMBER_EMAIL, password: PASSWORD },
      headers: { Origin: ORIGIN },
    });
  });

  test.afterAll(async () => {
    const svc = createServiceClient();
    if (entryId) await svc.from("standup_entries").delete().eq("id", entryId);
    if (workspaceId) await svc.from("workspace").delete().eq("id", workspaceId);
    if (memberId) await svc.auth.admin.deleteUser(memberId);
    if (otherMemberId) await svc.auth.admin.deleteUser(otherMemberId);
    await memberCtx?.dispose();
    await otherCtx?.dispose();
  });

  test("edit happy path — POST /api/standup/update updates content and redirects", async () => {
    test.skip(shouldSkip, "Requires local Supabase + fixtures (run npx supabase start first)");

    const resp = await getCtx().post("/api/standup/update", {
      form: { id: entryId, did: "updated did", plan: "updated plan", blockers: "" },
      headers: { Origin: ORIGIN },
      maxRedirects: 0,
    });

    expect(resp.status()).toBe(302);
    expect(resp.headers().location).toContain("/dashboard");

    const svc = createServiceClient();
    const { data } = await svc.from("standup_entries").select("did, blockers").eq("id", entryId).single();
    expect(data?.did).toBe("updated did");
    expect(data?.blockers).toBeNull();
  });

  test("ownership guard — another authenticated user cannot edit a different user's entry", async () => {
    test.skip(shouldSkip, "Requires local Supabase + fixtures (run npx supabase start first)");

    const resp = await getOtherCtx().post("/api/standup/update", {
      form: { id: entryId, did: "hacked did", plan: "hacked plan", blockers: "" },
      headers: { Origin: ORIGIN },
      maxRedirects: 0,
    });

    expect(resp.status()).toBe(302);
    expect(resp.headers().location).toContain("error=Entry+not+found");
  });

  test("delete happy path — POST /api/standup/delete removes the entry and redirects", async () => {
    test.skip(shouldSkip, "Requires local Supabase + fixtures (run npx supabase start first)");

    const resp = await getCtx().post("/api/standup/delete", {
      form: { id: entryId },
      headers: { Origin: ORIGIN },
      maxRedirects: 0,
    });

    expect(resp.status()).toBe(302);
    expect(resp.headers().location).toContain("/dashboard");

    const svc = createServiceClient();
    const { data } = await svc.from("standup_entries").select("id").eq("id", entryId).maybeSingle();
    expect(data).toBeNull();
    entryId = ""; // already gone — skip afterAll cleanup attempt
  });

  test("auth guard — unauthenticated POST is redirected to /auth/signin", async () => {
    test.skip(shouldSkip, "Requires local Supabase + fixtures (run npx supabase start first)");

    const anonCtx = await request.newContext({ baseURL: ORIGIN });
    const resp = await anonCtx.post("/api/standup/delete", {
      form: { id: crypto.randomUUID() },
      headers: { Origin: ORIGIN },
      maxRedirects: 0,
    });
    await anonCtx.dispose();

    expect(resp.status()).toBe(302);
    expect(resp.headers().location).toContain("/auth/signin");
  });
});
