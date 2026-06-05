import { Resend } from "resend";
import { RESEND_API_KEY } from "astro:env/server";

export async function sendInviteEmail(
  to: string,
  inviteLink: string,
  workspaceName: string,
): Promise<{ error: string | null }> {
  if (!RESEND_API_KEY) {
    console.info("[email] invite link for", to, ":", inviteLink);
    return { error: null };
  }

  const resend = new Resend(RESEND_API_KEY);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const { error } = await resend.emails.send({
    from: "noreply@standuptracker.app",
    to,
    subject: `You've been invited to join ${workspaceName}`,
    html: `<p>You've been invited to join <strong>${esc(workspaceName)}</strong>.</p>
<p><a href="${inviteLink}">Accept invitation</a></p>
<p>This link expires in 7 days.</p>`,
  });

  if (error) {
    return { error: error.message };
  }
  return { error: null };
}
