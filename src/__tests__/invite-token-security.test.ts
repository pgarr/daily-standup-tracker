import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isSupabaseRunning, createServiceClient, createUserClient, createSignInClient } from "./helpers/supabase-test";

interface DbSingleResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

const supabaseAvailable = await isSupabaseRunning();

describe.skipIf(!supabaseAvailable)(
  "accept_invitation() security — token replay, wrong-email, expiry (local Supabase not running — run npx supabase start)",
  () => {
    const svc = createServiceClient();
    const ts = Date.now();

    const REPLAY_TOKEN = `replay-${ts}`;
    const WRONG_EMAIL_TOKEN = `wrong-email-${ts}`;
    const EXPIRED_TOKEN = `expired-${ts}`;

    let workspaceId = "";
    let userAId = "";
    let userAToken = "";
    let userBTargetId = "";
    let userCId = "";
    let userCToken = "";

    beforeAll(async () => {
      // 1. Create workspace
      const wsResp = (await svc
        .from("workspace")
        .insert({ id: crypto.randomUUID(), name: `invite-sec-${ts}` })
        .select("id")
        .single()) as unknown as DbSingleResult<{ id: string }>;
      if (!wsResp.data) throw new Error(`workspace insert: ${wsResp.error?.message ?? "unknown"}`);
      workspaceId = wsResp.data.id;

      // 2. Create 3 test users
      const { data: authA, error: errA } = await svc.auth.admin.createUser({
        email: `invite-sec-a-${ts}@example.com`,
        password: "test-password-123",
        email_confirm: true,
      });
      if (!authA.user) throw new Error(`createUser A: ${errA?.message ?? "unknown"}`);
      userAId = authA.user.id;

      const { data: authBTarget, error: errBTarget } = await svc.auth.admin.createUser({
        email: `invite-sec-b-${ts}@example.com`,
        password: "test-password-123",
        email_confirm: true,
      });
      if (!authBTarget.user) throw new Error(`createUser B: ${errBTarget?.message ?? "unknown"}`);
      userBTargetId = authBTarget.user.id;

      const { data: authC, error: errC } = await svc.auth.admin.createUser({
        email: `invite-sec-c-${ts}@example.com`,
        password: "test-password-123",
        email_confirm: true,
      });
      if (!authC.user) throw new Error(`createUser C: ${errC?.message ?? "unknown"}`);
      userCId = authC.user.id;

      // 3. Insert 3 workspace_invitation rows
      const futureExpiry = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const pastExpiry = new Date(Date.now() - 3_600_000).toISOString();

      const { error: invErr } = await svc.from("workspace_invitation").insert([
        {
          workspace_id: workspaceId,
          email: `invite-sec-a-${ts}@example.com`,
          token: REPLAY_TOKEN,
          expires_at: futureExpiry,
        },
        {
          workspace_id: workspaceId,
          email: `invite-sec-b-${ts}@example.com`,
          token: WRONG_EMAIL_TOKEN,
          expires_at: futureExpiry,
        },
        {
          workspace_id: workspaceId,
          email: `invite-sec-c-${ts}@example.com`,
          token: EXPIRED_TOKEN,
          expires_at: pastExpiry,
        },
      ]);
      if (invErr) throw new Error(`invitation insert: ${invErr.message}`);

      // 4. Sign in user-a and user-c to get access tokens
      const signInClient = createSignInClient();

      const { data: sessionA, error: errSA } = await signInClient.auth.signInWithPassword({
        email: `invite-sec-a-${ts}@example.com`,
        password: "test-password-123",
      });
      if (!sessionA.session) throw new Error(`signIn A: ${errSA?.message ?? "unknown"}`);
      userAToken = sessionA.session.access_token;

      const { data: sessionC, error: errSC } = await signInClient.auth.signInWithPassword({
        email: `invite-sec-c-${ts}@example.com`,
        password: "test-password-123",
      });
      if (!sessionC.session) throw new Error(`signIn C: ${errSC?.message ?? "unknown"}`);
      userCToken = sessionC.session.access_token;

      // 5. User-a accepts REPLAY_TOKEN (positive case — establishes accepted_at)
      const { error: acceptErr } = await createUserClient(userAToken).rpc("accept_invitation", {
        p_token: REPLAY_TOKEN,
      });
      if (acceptErr) throw new Error(`positive acceptance failed: ${acceptErr.message}`);
    });

    afterAll(async () => {
      if (workspaceId) {
        const { error } = await svc.from("workspace").delete().eq("id", workspaceId);
        if (error) console.warn("workspace cleanup failed:", error.message);
      }
      for (const uid of [userAId, userBTargetId, userCId].filter(Boolean)) {
        await svc.auth.admin.deleteUser(uid);
      }
    });

    it("positive: user-a workspace_member row exists after first acceptance", async () => {
      const { data } = await createUserClient(userAToken)
        .from("workspace_member")
        .select("role")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      expect(data?.role).toBe("member");
    });

    it("replay: second acceptance of same token is rejected", async () => {
      const { error } = await createUserClient(userAToken).rpc("accept_invitation", {
        p_token: REPLAY_TOKEN,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("invalid or expired invitation");
    });

    it("wrong-email binding: user-c cannot accept user-b-target's token", async () => {
      const { error } = await createUserClient(userCToken).rpc("accept_invitation", {
        p_token: WRONG_EMAIL_TOKEN,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("invalid or expired invitation");
    });

    it("expiry: user-c cannot accept an expired token", async () => {
      const { error } = await createUserClient(userCToken).rpc("accept_invitation", {
        p_token: EXPIRED_TOKEN,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("invalid or expired invitation");
    });
  },
);
