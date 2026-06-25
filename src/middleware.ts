import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { AUTH_REQUIRED_ROUTES, WORKSPACE_REQUIRED_ROUTES, WORKSPACE_SETUP_REDIRECT } from "@/lib/routes";
import type { Workspace, WorkspaceMember } from "@/types";

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  context.locals.workspace = null;
  context.locals.workspaceMember = null;

  const { pathname } = context.url;

  if (context.locals.user && pathname === "/") {
    return context.redirect("/dashboard");
  }

  if (supabase && context.locals.user && !pathname.startsWith("/api")) {
    type MemberRow = WorkspaceMember & { workspace: Workspace | null };
    const memberResult = await supabase
      .from("workspace_member")
      .select("*, workspace:workspace_id(*)")
      .eq("user_id", context.locals.user.id)
      .limit(1)
      .maybeSingle();
    if (memberResult.error) console.error("[middleware] workspace query failed:", memberResult.error);
    // No generated Supabase types for this table; remove cast after npx supabase gen types typescript
    const member = memberResult.data as unknown as MemberRow | null;

    if (member) {
      const { workspace, ...memberData } = member;
      context.locals.workspace = workspace ?? null;
      context.locals.workspaceMember = memberData;
    }
  }

  if (WORKSPACE_REQUIRED_ROUTES.some((r) => pathname.startsWith(r))) {
    if (!context.locals.user) return context.redirect("/auth/signin");
    if (!context.locals.workspace) return context.redirect(WORKSPACE_SETUP_REDIRECT);
  } else if (AUTH_REQUIRED_ROUTES.some((r) => pathname.startsWith(r))) {
    if (!context.locals.user) return context.redirect("/auth/signin");
  }

  return next();
});
