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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/auth/confirm-email");
};
