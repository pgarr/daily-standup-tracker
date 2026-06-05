import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  // /api/workspace/* is not covered by AUTH_REQUIRED_ROUTES
  // (middleware matches /workspace, not /api) — this guard is required.
  if (!user) {
    return context.redirect("/auth/signin");
  }
  if (context.locals.workspaceMember) {
    return context.redirect("/dashboard");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/workspace/setup?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const form = await context.request.formData();
  const result = schema.safeParse({ name: form.get("name") });
  if (!result.success) {
    const issues = result.error.issues;
    const message = issues.length > 0 && issues[0] ? issues[0].message : "Invalid input";
    return context.redirect(`/workspace/setup?error=${encodeURIComponent(message)}`);
  }

  const { name } = result.data;
  // Lesson (F-01): client-generated UUID required — workspace SELECT RLS policy
  // depends on workspace_member existing first, so we cannot use return=representation.
  const workspaceId = crypto.randomUUID();

  const { error: workspaceError } = await supabase.from("workspace").insert({ id: workspaceId, name });
  if (workspaceError) {
    return context.redirect(`/workspace/setup?error=${encodeURIComponent(workspaceError.message)}`);
  }

  const { error: memberError } = await supabase
    .from("workspace_member")
    .insert({ workspace_id: workspaceId, user_id: user.id, role: "team_lead" });

  if (memberError) {
    // Compensating DELETE — best-effort cleanup of the orphaned workspace row.
    const { error: deleteError } = await supabase.from("workspace").delete().eq("id", workspaceId);
    if (deleteError) {
      console.error("[workspace/create] compensating delete failed:", deleteError);
    }
    return context.redirect(`/workspace/setup?error=${encodeURIComponent(memberError.message)}`);
  }

  return context.redirect("/dashboard");
};
