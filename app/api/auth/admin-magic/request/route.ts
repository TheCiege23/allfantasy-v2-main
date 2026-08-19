import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from "next/server";
import { getResendClient } from "@/lib/resend-client";
import { signAdminMagicToken } from "@/lib/adminSession";
import { isAdminEmailAllowed } from "@/lib/adminAuth";
import { getDeploymentLinkOrigin } from "@/lib/site-public-origin";

function sanitizeNext(next?: string) {
  if (!next) return "/admin";
  if (!next.startsWith("/")) return "/admin";
  if (next.startsWith("//")) return "/admin";
  if (!next.startsWith("/admin")) return "/admin";
  return next;
}

export const POST = withApiUsage({ endpoint: "/api/auth/admin-magic/request", tool: "AuthAdminMagicRequest" })(async (req: Request) => {
  try {
    const body = await req.json().catch(() => ({} as any));
    const email = String(body?.email || "").trim().toLowerCase();
    const next = sanitizeNext(String(body?.next || "/admin"));

    const safeOk = NextResponse.json({ ok: true });

    if (!email || !email.includes("@")) return safeOk;
    if (!isAdminEmailAllowed(email)) return safeOk;

    const token = signAdminMagicToken(email, next, 10 * 60);
    // Preview-aware, spoof-safe origin: on a preview deployment this is the preview's own
    // Vercel host, so the emailed link returns to the SAME preview (not production). Never
    // derived from the request Host header. Production is unchanged (configured canonical).
    const baseUrl = getDeploymentLinkOrigin();
    const link = baseUrl
      ? `${baseUrl.replace(/\/$/, "")}/api/auth/admin-magic/consume?token=${encodeURIComponent(token)}`
      : `/api/auth/admin-magic/consume?token=${encodeURIComponent(token)}`;

    const { client: resend, fromEmail } = await getResendClient();

    await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "Your AllFantasy Admin Magic Link",
      html: `
        <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size:16px; color:#111;">
          <p>Here's your one-time admin login link (expires in 10 minutes):</p>
          <p><a href="${link}">Login to Admin</a></p>
          <p style="color:#555;">If you didn't request this, you can ignore this email.</p>
        </div>
      `.trim(),
    });

    return safeOk;
  } catch {
    return NextResponse.json({ ok: true });
  }
})
