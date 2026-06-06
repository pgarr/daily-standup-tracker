export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const result = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid input";
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }

  const { email, password } = result.data;
  const rawInviteToken = form.get("invite_token");
  const inviteToken = typeof rawInviteToken === "string" ? rawInviteToken : null;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  if (inviteToken) {
    return context.redirect(`/auth/accept-invite?token=${encodeURIComponent(inviteToken)}`);
  }
  return context.redirect("/dashboard");
};
