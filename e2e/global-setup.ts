import { mkdirSync, writeFileSync } from "fs";
import { createServiceClient, isSupabaseRunning } from "../src/__tests__/helpers/supabase-test";

export const FIXTURES_PATH = ".auth/test-fixtures.json";

interface DbSingleResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

export default async function globalSetup(): Promise<void> {
  if (!(await isSupabaseRunning())) return;

  const svc = createServiceClient();
  const ts = Date.now();
  const email = (role: string) => `role-gate-${role}-${ts}@example.com`;
  const PASSWORD = "test-password-123";

  // Create team_lead user
  const { data: authLead, error: errLead } = await svc.auth.admin.createUser({
    email: email("team-lead"),
    password: PASSWORD,
    email_confirm: true,
  });
  if (!authLead.user) throw new Error(`createUser team_lead: ${errLead?.message ?? "unknown"}`);

  // Create member user
  const { data: authMember, error: errMember } = await svc.auth.admin.createUser({
    email: email("member"),
    password: PASSWORD,
    email_confirm: true,
  });
  if (!authMember.user) throw new Error(`createUser member: ${errMember?.message ?? "unknown"}`);

  // Create workspace
  const workspaceId = crypto.randomUUID();
  const wsResp = (await svc
    .from("workspace")
    .insert({ id: workspaceId, name: `role-gate-${ts}` })
    .select("id")
    .single()) as unknown as DbSingleResult<{ id: string }>;
  if (!wsResp.data) throw new Error(`workspace insert: ${wsResp.error?.message ?? "unknown"}`);

  // Insert workspace_member rows
  const { error: memberErr } = await svc.from("workspace_member").insert([
    { workspace_id: workspaceId, user_id: authLead.user.id, role: "team_lead" },
    { workspace_id: workspaceId, user_id: authMember.user.id, role: "member" },
  ]);
  if (memberErr) throw new Error(`workspace_member insert: ${memberErr.message}`);

  mkdirSync(".auth", { recursive: true });
  writeFileSync(
    FIXTURES_PATH,
    JSON.stringify({
      teamLead: { id: authLead.user.id, email: email("team-lead"), password: PASSWORD },
      member: { id: authMember.user.id, email: email("member"), password: PASSWORD },
      workspaceId,
    }),
  );
}
