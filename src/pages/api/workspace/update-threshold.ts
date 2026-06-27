export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  threshold: z.coerce.number().int().min(1, "Threshold must be at least 1"),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const requestOrigin = context.request.headers.get("Origin") ?? context.request.headers.get("Referer");
  if (requestOrigin) {
    try {
      if (new URL(requestOrigin).origin !== context.url.origin) {
        return new Response("Forbidden", { status: 403 });
      }
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/team-feed?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // API routes skip middleware workspace loading — load it here.
  const { data: member, error: memberError } = await supabase
    .from("workspace_member")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    return context.redirect(`/team-feed?error=${encodeURIComponent("Failed to load workspace")}`);
  }
  if (!member) {
    return context.redirect("/workspace/setup");
  }
  if (member.role !== "team_lead") {
    return context.redirect(
      `/team-feed?error=${encodeURIComponent("Only the Team Lead can change the alert threshold")}`,
    );
  }

  const form = await context.request.formData();
  const result = schema.safeParse({ threshold: form.get("threshold") });
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid threshold value";
    return context.redirect(`/team-feed?error=${encodeURIComponent(message)}`);
  }

  const { error } = await supabase
    .from("workspace")
    .update({ alert_threshold: result.data.threshold })
    .eq("id", member.workspace_id);

  if (error) {
    return context.redirect(`/team-feed?error=${encodeURIComponent("Failed to update threshold")}`);
  }

  return context.redirect("/team-feed?success=threshold_updated");
};
