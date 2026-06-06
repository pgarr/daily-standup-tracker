export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const result = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!result.success) {
    const issues = result.error.issues;
    const message = issues.length > 0 && issues[0] ? issues[0].message : "Invalid input";
    return context.redirect(`/auth/signup?error=${encodeURIComponent(message)}`);
  }

  const { email, password } = result.data;
  const rawInviteToken = form.get("invite_token");
  const inviteToken = typeof rawInviteToken === "string" ? rawInviteToken : null;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // When signing up via an invite, verify the submitted email matches the invite before creating an account.
  if (inviteToken) {
    const { data: inviteData, error: inviteError } = await supabase
      .rpc("get_invitation_by_token", { p_token: inviteToken })
      .maybeSingle();
    const redirectBase = `/auth/accept-invite?token=${encodeURIComponent(inviteToken)}`;
    if (inviteError) {
      return context.redirect(`${redirectBase}&error=service_error`);
    }
    if (inviteData?.email !== email) {
      return context.redirect(`${redirectBase}&error=invite_invalid`);
    }
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: inviteToken
      ? {
          emailRedirectTo: `${context.url.origin}/auth/accept-invite?token=${encodeURIComponent(inviteToken)}`,
        }
      : undefined,
  });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  // data.session is non-null in dev (auto-confirm); null in prod (email confirmation pending).
  // In both paths, redirect to the accept-invite PAGE — it detects auth state and shows the Join button.
  if (data.session && inviteToken) {
    return context.redirect(`/auth/accept-invite?token=${encodeURIComponent(inviteToken)}`);
  }
  if (inviteToken) {
    return context.redirect(`/auth/confirm-email?invite_token=${encodeURIComponent(inviteToken)}`);
  }
  return context.redirect("/auth/confirm-email");
};
