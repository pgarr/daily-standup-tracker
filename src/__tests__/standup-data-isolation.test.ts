import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isSupabaseRunning, createServiceClient, createUserClient, createSignInClient } from "./helpers/supabase-test";

const supabaseAvailable = await isSupabaseRunning();

interface DbSingleResult<T> {
  data: T | null;
  error: { message?: string } | null;
}
interface EntryRow {
  id: string;
}

describe.skipIf(!supabaseAvailable)(
  "standup_entries RLS — data isolation (local Supabase not running — run npx supabase start)",
  () => {
    const svc = createServiceClient();

    let userAId = "";
    let userBId = "";
    let userAToken = "";
    let userBToken = "";
    let workspaceAId = "";
    let workspaceBId = "";
    let entryAId = "";

    beforeAll(async () => {
      const ts = Date.now();

      // 1. Create two test users
      const { data: authA, error: errA } = await svc.auth.admin.createUser({
        email: `rls-a-${ts}@example.com`,
        password: "test-password-123",
        email_confirm: true,
      });
      if (!authA.user) throw new Error(`createUser userA: ${errA?.message ?? "unknown"}`);
      userAId = authA.user.id;

      const { data: authB, error: errB } = await svc.auth.admin.createUser({
        email: `rls-b-${ts}@example.com`,
        password: "test-password-123",
        email_confirm: true,
      });
      if (!authB.user) throw new Error(`createUser userB: ${errB?.message ?? "unknown"}`);
      userBId = authB.user.id;

      // 2. Create workspaceA and workspaceB (B is a workspace User B will NOT be a member of)
      const wsAResp = (await svc
        .from("workspace")
        .insert({ id: crypto.randomUUID(), name: `rls-test-a-${ts}` })
        .select("id")
        .single()) as unknown as DbSingleResult<{ id: string }>;
      if (!wsAResp.data) throw new Error(`workspace A insert: ${wsAResp.error?.message ?? "unknown"}`);
      workspaceAId = wsAResp.data.id;

      const wsBResp = (await svc
        .from("workspace")
        .insert({ id: crypto.randomUUID(), name: `rls-test-b-${ts}` })
        .select("id")
        .single()) as unknown as DbSingleResult<{ id: string }>;
      if (!wsBResp.data) throw new Error(`workspace B insert: ${wsBResp.error?.message ?? "unknown"}`);
      workspaceBId = wsBResp.data.id;

      // 3. Insert workspace_member rows for both users into workspaceA
      const { error: wmErr } = await svc.from("workspace_member").insert([
        {
          id: crypto.randomUUID(),
          workspace_id: workspaceAId,
          user_id: userAId,
          role: "member",
        },
        {
          id: crypto.randomUUID(),
          workspace_id: workspaceAId,
          user_id: userBId,
          role: "member",
        },
      ]);
      if (wmErr) throw new Error(`workspace_member insert: ${wmErr.message}`);

      // 4. Insert entryA for User A via service client (auth_user_workspace_id() not available here)
      entryAId = crypto.randomUUID();
      await svc.from("standup_entries").insert({
        id: entryAId,
        workspace_id: workspaceAId,
        user_id: userAId,
        submitted_date: "2026-06-01",
        did: "test",
        plan: "test",
        blockers: null,
      });

      // 5. Sign in as each user to get access tokens
      const signInClient = createSignInClient();
      const { data: sessionA, error: errSA } = await signInClient.auth.signInWithPassword({
        email: `rls-a-${ts}@example.com`,
        password: "test-password-123",
      });
      if (!sessionA.session) throw new Error(`signIn userA: ${errSA?.message ?? "unknown"}`);
      userAToken = sessionA.session.access_token;

      const { data: sessionB, error: errSB } = await signInClient.auth.signInWithPassword({
        email: `rls-b-${ts}@example.com`,
        password: "test-password-123",
      });
      if (!sessionB.session) throw new Error(`signIn userB: ${errSB?.message ?? "unknown"}`);
      userBToken = sessionB.session.access_token;
    });

    afterAll(async () => {
      if (workspaceAId || workspaceBId) {
        await svc.from("workspace").delete().in("id", [workspaceAId, workspaceBId].filter(Boolean));
      }
      if (userAId) await svc.auth.admin.deleteUser(userAId);
      if (userBId) await svc.auth.admin.deleteUser(userBId);
    });

    it("User B sees no standup entries", async () => {
      const { data, error } = await createUserClient(userBToken).from("standup_entries").select("*");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("User B cannot see User A's entry by known ID", async () => {
      const { data, error } = await createUserClient(userBToken).from("standup_entries").select("*").eq("id", entryAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("INSERT with User A's user_id rejected (IDOR)", async () => {
      const { error } = await createUserClient(userBToken).from("standup_entries").insert({
        user_id: userAId,
        workspace_id: workspaceAId,
        submitted_date: "2026-06-02",
        did: "x",
        plan: "x",
      });
      expect(error?.code).toBe("42501");
      expect(error?.message).toContain("row-level security");
    });

    // workspaceB is "foreign" because beforeAll never inserted a workspace_member row for User B there.
    it("INSERT with foreign workspace_id rejected", async () => {
      const { error } = await createUserClient(userBToken).from("standup_entries").insert({
        user_id: userBId,
        workspace_id: workspaceBId,
        submitted_date: "2026-06-02",
        did: "x",
        plan: "x",
      });
      expect(error?.code).toBe("42501");
      expect(error?.message).toContain("row-level security");
    });

    it("User A sees their own entry (positive case)", async () => {
      const resp = (await createUserClient(userAToken)
        .from("standup_entries")
        .select("id")) as unknown as DbSingleResult<EntryRow[]>;
      expect(resp.error).toBeNull();
      expect(resp.data).toHaveLength(1);
      expect(resp.data?.[0]?.id).toBe(entryAId);
    });
  },
);
