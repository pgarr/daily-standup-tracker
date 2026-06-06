export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  did: z.string().min(1, "What you did is required"),
  plan: z.string().min(1, "Plan for today is required"),
  blockers: z.string().optional().nullable(),
  // submitted_date is the user's local business date, sent from the client via
  // new Date().toLocaleDateString("sv"). Server-side clamping is deliberately omitted
  // (see plan §What We're NOT Doing); streak integrity relies on user trust at MVP scope.
  submitted_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const form = await context.request.formData();
  const result = schema.safeParse({
    did: form.get("did"),
    plan: form.get("plan"),
    blockers: form.get("blockers"),
    submitted_date: form.get("submitted_date"),
  });
  if (!result.success) {
    const issues = result.error.issues;
    const message = issues.length > 0 && issues[0] ? issues[0].message : "Invalid input";
    return context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }

  // Middleware skips workspace loading for /api/* routes — must query workspace_member directly.
  const { data: member, error: memberError } = await supabase
    .from("workspace_member")
    .select("workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Failed to load workspace")}`);
  }
  if (!member) {
    return context.redirect("/workspace/setup");
  }

  const rawBlockers = result.data.blockers?.trim() ?? "";
  const { error } = await supabase.from("standup_entries").insert({
    workspace_id: member.workspace_id,
    user_id: user.id,
    submitted_date: result.data.submitted_date,
    did: result.data.did,
    plan: result.data.plan,
    blockers: rawBlockers !== "" ? rawBlockers : null,
  });

  if (error) {
    if (error.code === "23505") {
      return context.redirect(`/dashboard?error=${encodeURIComponent("You already submitted a standup today.")}`);
    }
    return context.redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/dashboard");
};
