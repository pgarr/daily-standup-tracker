import { existsSync, readFileSync } from "fs";
import { createServiceClient } from "../src/__tests__/helpers/supabase-test";
import { FIXTURES_PATH } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(FIXTURES_PATH)) return;

  const { teamLead, member, workspaceId } = JSON.parse(readFileSync(FIXTURES_PATH, "utf-8")) as {
    teamLead: { id: string };
    member: { id: string };
    workspaceId: string;
  };

  const svc = createServiceClient();
  try {
    await svc.from("workspace").delete().eq("id", workspaceId);
    await svc.auth.admin.deleteUser(teamLead.id);
    await svc.auth.admin.deleteUser(member.id);
  } catch (err) {
    console.warn("[teardown] cleanup failed — manually delete workspace", workspaceId, err);
  }
}
