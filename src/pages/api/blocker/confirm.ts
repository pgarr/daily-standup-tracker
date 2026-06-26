export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  trigger_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
    return context.redirect("/dashboard");
  }

  const form = await context.request.formData();
  const result = schema.safeParse({ trigger_date: form.get("trigger_date") });
  if (!result.success) {
    return context.redirect("/dashboard");
  }

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

  const { error } = await supabase.from("blocker_alerts").upsert(
    {
      workspace_id: member.workspace_id,
      user_id: user.id,
      trigger_date: result.data.trigger_date,
      status: "confirmed",
    },
    // ignoreDuplicates: first action (confirm or dismiss) wins for a given trigger_date; alerts are immutable by design
    { onConflict: "user_id,trigger_date", ignoreDuplicates: true },
  );

  if (error) {
    return context.redirect(`/dashboard?error=${encodeURIComponent("Failed to record blocker alert")}`);
  }

  return context.redirect("/dashboard");
};
