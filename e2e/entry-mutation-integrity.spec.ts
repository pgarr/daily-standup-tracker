import { test, expect, request } from "@playwright/test";
import {
  isSupabaseRunning,
  createServiceClient,
  createUserClient,
  createSignInClient,
} from "../src/__tests__/helpers/supabase-test";

// Pessimistic default — flipped to false in beforeAll when conditions are met.
let shouldSkip = true;
let memberCtx: Awaited<ReturnType<typeof request.newContext>> | undefined;

let memberId = "";
let otherMemberId = "";
let workspaceId = "";
let entryIdMon = "";
let entryIdTue = "";
let entryIdWed = "";
let alertId = "";

const ts = Date.now();
const MEMBER_EMAIL = `mutation-member-${ts}@example.com`;
const OTHER_MEMBER_EMAIL = `mutation-other-${ts}@example.com`;
const PASSWORD = "test-password-123";
const ORIGIN = "http://localhost:4321";

const DATE_MON = "2020-01-06";
const DATE_TUE = "2020-01-07";
const DATE_WED = "2020-01-08";

function getCtx() {
  if (!memberCtx) throw new Error("memberCtx not initialized");
  return memberCtx;
}

test.describe.serial("entry mutation integrity (requires local Supabase + npm run dev)", () => {
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
    const { error: wsErr } = await svc.from("workspace").insert({ id: workspaceId, name: `mutation-${ts}` });
    if (wsErr) throw new Error(`workspace insert: ${wsErr.message}`);

    // workspace_member for primary user
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

    // Insert three standup entries (Mon/Tue/Wed) with pre-generated UUIDs
    entryIdMon = crypto.randomUUID();
    entryIdTue = crypto.randomUUID();
    entryIdWed = crypto.randomUUID();

    const { error: entryErr } = await svc.from("standup_entries").insert([
      {
        id: entryIdMon,
        workspace_id: workspaceId,
        user_id: memberId,
        submitted_date: DATE_MON,
        did: "mon did",
        plan: "mon plan",
        blockers: null,
      },
      {
        id: entryIdTue,
        workspace_id: workspaceId,
        user_id: memberId,
        submitted_date: DATE_TUE,
        did: "tue did",
        plan: "tue plan",
        blockers: null,
      },
      {
        id: entryIdWed,
        workspace_id: workspaceId,
        user_id: memberId,
        submitted_date: DATE_WED,
        did: "wed did",
        plan: "wed plan",
        blockers: null,
      },
    ]);
    if (entryErr) throw new Error(`standup_entries insert: ${entryErr.message}`);

    // Insert confirmed blocker_alert for Tue (no FK to standup_entries — orphan contract)
    alertId = crypto.randomUUID();
    const { error: alertErr } = await svc.from("blocker_alerts").insert({
      id: alertId,
      workspace_id: workspaceId,
      user_id: memberId,
      trigger_date: DATE_TUE,
      status: "confirmed",
    });
    if (alertErr) throw new Error(`blocker_alerts insert: ${alertErr.message}`);

    // Create second user + workspace_member (used only for RLS DB-layer test)
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
  });

  test.afterAll(async () => {
    const svc = createServiceClient();
    if (entryIdMon) await svc.from("standup_entries").delete().eq("id", entryIdMon);
    if (entryIdTue) await svc.from("standup_entries").delete().eq("id", entryIdTue);
    if (entryIdWed) await svc.from("standup_entries").delete().eq("id", entryIdWed);
    if (workspaceId) await svc.from("workspace").delete().eq("id", workspaceId);
    if (memberId) await svc.auth.admin.deleteUser(memberId);
    if (otherMemberId) await svc.auth.admin.deleteUser(otherMemberId);
    await memberCtx?.dispose();
  });

  test("streak recalculates — deleting the most recent entry removes it from the streak-input array", async () => {
    test.skip(shouldSkip, "Requires local Supabase + fixtures (run npx supabase start first)");

    const resp = await getCtx().post("/api/standup/delete", {
      form: { id: entryIdWed },
      headers: { Origin: ORIGIN },
      maxRedirects: 0,
    });

    expect(resp.status()).toBe(302);
    expect(resp.headers().location).toContain("success=entry_deleted");

    const svc = createServiceClient();
    const { data } = await svc
      .from("standup_entries")
      .select("submitted_date")
      .eq("user_id", memberId)
      .order("submitted_date", { ascending: false });
    expect(data?.map((r: { submitted_date: string }) => r.submitted_date)).toEqual([DATE_TUE, DATE_MON]);

    entryIdWed = "";
  });

  test("alert not orphaned — confirmed blocker_alert survives deletion of its associated entry", async () => {
    test.skip(shouldSkip, "Requires local Supabase + fixtures (run npx supabase start first)");

    const svc = createServiceClient();

    const { data: before } = await svc.from("blocker_alerts").select("id").eq("id", alertId).maybeSingle();
    expect(before).not.toBeNull();

    const resp = await getCtx().post("/api/standup/delete", {
      form: { id: entryIdTue },
      headers: { Origin: ORIGIN },
      maxRedirects: 0,
    });
    expect(resp.status()).toBe(302);

    const { data: after } = await svc.from("blocker_alerts").select("id").eq("id", alertId).maybeSingle();
    expect(after).not.toBeNull();

    entryIdTue = "";
  });

  test("write-path IDOR — RLS blocks cross-user UPDATE and DELETE at the database layer", async () => {
    test.skip(shouldSkip, "Requires local Supabase + fixtures (run npx supabase start first)");

    const { data: signInData, error: signInErr } = await createSignInClient().auth.signInWithPassword({
      email: OTHER_MEMBER_EMAIL,
      password: PASSWORD,
    });
    if (!signInData.session) throw new Error(`signInWithPassword other: ${signInErr?.message ?? "no session"}`);
    const otherClient = createUserClient(signInData.session.access_token);

    const { count: updateCount, error: updateErr } = await otherClient
      .from("standup_entries")
      .update({ did: "hacked" }, { count: "exact" })
      .eq("id", entryIdMon);
    expect(updateErr).toBeNull();
    expect(updateCount).toBe(0);

    const { count: deleteCount } = await otherClient
      .from("standup_entries")
      .delete({ count: "exact" })
      .eq("id", entryIdMon);
    expect(deleteCount).toBe(0);

    const svc = createServiceClient();
    const { data } = await svc.from("standup_entries").select("did").eq("id", entryIdMon).single();
    expect(data?.did).toBe("mon did");
  });
});
