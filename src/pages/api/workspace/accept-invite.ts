export const prerender = false;

import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  token: z.string().min(1, "Token is required"),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/accept-invite?error=${encodeURIComponent("Service unavailable")}`);
  }

  const form = await context.request.formData();
  const result = schema.safeParse({ token: form.get("token") });
  if (!result.success) {
    return context.redirect(`/auth/accept-invite?error=${encodeURIComponent("Invalid request")}`);
  }

  const { token } = result.data;

  const { error } = await supabase.rpc("accept_invitation", { p_token: token });

  if (error) {
    if (error.message.includes("invalid or expired invitation")) {
      return context.redirect(`/auth/accept-invite?token=${encodeURIComponent(token)}&error=invite_invalid`);
    }
    if (error.message.includes("already a member of a workspace")) {
      return context.redirect(`/auth/accept-invite?token=${encodeURIComponent(token)}&error=already_in_workspace`);
    }
    return context.redirect(
      `/auth/accept-invite?token=${encodeURIComponent(token)}&error=${encodeURIComponent(error.message)}`,
    );
  }

  return context.redirect("/dashboard");
};
