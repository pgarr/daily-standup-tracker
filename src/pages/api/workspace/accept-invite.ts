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
  const form = await context.request.formData();
  const rawToken = form.get("token") as string | null;

  if (!supabase) {
    const base = rawToken ? `/auth/accept-invite?token=${encodeURIComponent(rawToken)}&` : "/auth/accept-invite?";
    return context.redirect(`${base}error=service_error`);
  }

  const result = schema.safeParse({ token: rawToken });
  if (!result.success) {
    const base = rawToken ? `/auth/accept-invite?token=${encodeURIComponent(rawToken)}&` : "/auth/accept-invite?";
    return context.redirect(`${base}error=${encodeURIComponent("Invalid request")}`);
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
    return context.redirect(`/auth/accept-invite?token=${encodeURIComponent(token)}&error=service_error`);
  }

  return context.redirect("/dashboard");
};
