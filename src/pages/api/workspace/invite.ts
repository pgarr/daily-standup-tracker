import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { sendInviteEmail } from "@/lib/email";
import type { Workspace, WorkspaceMember } from "@/types";

const schema = z.object({
  email: z.email("Enter a valid email address"),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/workspace/members?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // API routes skip middleware workspace loading — load it here.
  type MemberRowWithWorkspace = WorkspaceMember & { workspace: Workspace | null };
  const memberResult = await supabase
    .from("workspace_member")
    .select("*, workspace:workspace_id(*)")
    .eq("user_id", user.id)
    .maybeSingle();
  const memberRow = memberResult.data as unknown as MemberRowWithWorkspace | null;

  if (memberRow?.role !== "team_lead") {
    return context.redirect("/auth/signin");
  }

  const workspace = memberRow.workspace;
  if (!workspace) {
    return context.redirect(`/workspace/members?error=${encodeURIComponent("Workspace not found")}`);
  }

  const form = await context.request.formData();
  const result = schema.safeParse({ email: form.get("email") });
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid input";
    return context.redirect(`/workspace/members?error=${encodeURIComponent(message)}`);
  }

  const { email } = result.data;
  const token = crypto.randomUUID();

  const { error: insertError } = await supabase
    .from("workspace_invitation")
    .insert({ workspace_id: workspace.id, email, token, role: "member" });

  if (insertError) {
    const message = insertError.code === "23505" ? "An invite for this email is already pending" : insertError.message;
    return context.redirect(`/workspace/members?error=${encodeURIComponent(message)}`);
  }

  const inviteLink = `${context.url.origin}/auth/accept-invite?token=${token}`;
  const { error: emailError } = await sendInviteEmail(email, inviteLink, workspace.name);

  if (emailError) {
    return context.redirect("/workspace/members?success=invite_created&email_warning=1");
  }

  return context.redirect("/workspace/members?success=invite_sent");
};
