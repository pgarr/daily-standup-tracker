import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import type { Workspace, WorkspaceMember } from "@/types";

const AUTH_REQUIRED_ROUTES = ["/dashboard", "/workspace"];
const WORKSPACE_REQUIRED_ROUTES = ["/dashboard"];

export const onRequest = defineMiddleware(async (context, next) => {
  const client = createClient(context.request.headers, context.cookies);

  if (client) {
    const {
      data: { user },
    } = await client.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  context.locals.workspace = null;
  context.locals.workspaceMember = null;

  if (client && context.locals.user) {
    type MemberRow = WorkspaceMember & { workspace: Workspace | null };
    const memberResult = await client
      .from("workspace_member")
      .select("*, workspace:workspace_id(*)")
      .eq("user_id", context.locals.user.id)
      .limit(1)
      .maybeSingle();
    const member = memberResult.data as unknown as MemberRow | null;

    if (member) {
      const { workspace, ...memberData } = member;
      context.locals.workspace = workspace ?? null;
      context.locals.workspaceMember = memberData;
    }
  }

  const { pathname } = context.url;

  if (WORKSPACE_REQUIRED_ROUTES.some((r) => pathname.startsWith(r))) {
    if (!context.locals.user) return context.redirect("/auth/signin");
    if (!context.locals.workspace) return context.redirect("/workspace/setup");
  } else if (AUTH_REQUIRED_ROUTES.some((r) => pathname.startsWith(r))) {
    if (!context.locals.user) return context.redirect("/auth/signin");
  }

  return next();
});
