import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  id: z.uuid("Invalid invite ID"),
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
  const { data: memberData } = await supabase
    .from("workspace_member")
    .select("id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberData?.role !== "team_lead") {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const result = schema.safeParse({ id: form.get("id") });
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid input";
    return context.redirect(`/workspace/members?error=${encodeURIComponent(message)}`);
  }

  const { id } = result.data;
  const { error, count } = await supabase.from("workspace_invitation").delete({ count: "exact" }).eq("id", id);

  if (error) {
    return context.redirect(`/workspace/members?error=${encodeURIComponent(error.message)}`);
  }

  if (count === 0) {
    return context.redirect(
      `/workspace/members?error=${encodeURIComponent("Invitation not found or already cancelled")}`,
    );
  }

  return context.redirect("/workspace/members?success=invite_cancelled");
};
