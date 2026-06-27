export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  id: z.uuid(),
  did: z.string().min(1, "What you did is required"),
  plan: z.string().min(1, "Plan for today is required"),
  blockers: z.string().optional().nullable(),
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
    return context.redirect(`/dashboard?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const form = await context.request.formData();
  const result = schema.safeParse({
    id: form.get("id"),
    did: form.get("did"),
    plan: form.get("plan"),
    blockers: form.get("blockers"),
  });
  if (!result.success) {
    const issues = result.error.issues;
    const message = issues.length > 0 && issues[0] ? issues[0].message : "Invalid input";
    return context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }

  const { id, did, plan, blockers } = result.data;
  const { error, count } = await supabase
    .from("standup_entries")
    .update({ did, plan, blockers: blockers?.trim() ?? null }, { count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return context.redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }
  if (count === 0) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Entry not found")}`);
  }

  return context.redirect("/dashboard?success=entry_updated");
};
