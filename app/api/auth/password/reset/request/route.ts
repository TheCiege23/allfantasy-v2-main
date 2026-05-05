import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sha256Hex, makeToken } from "@/lib/tokens"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { logPasswordResetAudit } from "@/lib/auth/password-reset-audit"
import { getResendFromEmail } from "@/lib/resend-client"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export const runtime = "nodejs"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function resolvePasswordResetAppBase(req: Request): string {
  const requestOrigin = new URL(req.url).origin

  if (process.env.NODE_ENV === "production") {
    try {
      const hostname = new URL(requestOrigin).hostname.toLowerCase()
      if (hostname && hostname !== "localhost" && !hostname.endsWith(".vercel.app")) {
        return requestOrigin
      }
    } catch {}

    return getPublicSiteOrigin()
  }

  return (
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    requestOrigin
  )
}

export async function POST(req: Request) {
  try {
  const ip = getClientIp(req)
  const rl = rateLimit(`pw-reset:${ip}`, 5, 600_000)
  if (!rl.success) {
    void logPasswordResetAudit({
      outcome: "rate_limited",
      type: "email",
      ip,
      detail: { limiter: "pw-reset" },
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const body = await req.json().catch(() => ({}))
  const type = String(body?.type || "email").toLowerCase()
  const returnTo = typeof body?.returnTo === "string" ? body.returnTo : null
  const email = String(body?.email || "").toLowerCase().trim()
  let phone = String(body?.phone || "").trim().replace(/[\s()-]/g, "")
  if (phone && !phone.startsWith("+")) phone = "+1" + phone

  if (type === "sms") {
    if (!/^\+\d{10,15}$/.test(phone)) {
      void logPasswordResetAudit({
        outcome: "invalid_sms_phone",
        type: "sms",
        phone,
        ip,
      })
      return NextResponse.json({ ok: true }, { status: 200 })
    }
    const profile = await (prisma as any).userProfile.findUnique({
      where: { phone },
      select: { userId: true },
    }).catch(() => null)
    if (!profile) {
      void logPasswordResetAudit({
        outcome: "sms_profile_not_found",
        type: "sms",
        phone,
        ip,
      })
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const tokenHash = sha256Hex(code)
    const expiresAt = new Date(Date.now() + 1000 * 60 * 15)

    await (prisma as any).passwordResetToken.deleteMany({
      where: { userId: profile.userId },
    }).catch(() => {})

    await (prisma as any).passwordResetToken.create({
      data: { userId: profile.userId, tokenHash, expiresAt },
    })

    try {
      const { getTwilioClient } = await import("@/lib/twilio-client")
      const client = await getTwilioClient()
      const fromNumber = process.env.TWILIO_PHONE_NUMBER
      if (!fromNumber) {
        void logPasswordResetAudit({
          outcome: "sms_provider_missing",
          type: "sms",
          userId: profile.userId,
          phone,
          ip,
        })
        return NextResponse.json({ ok: true }, { status: 200 })
      }
      await client.messages.create({
        body: `Your AllFantasy password reset code is: ${code}. It expires in 15 minutes.`,
        from: fromNumber,
        to: phone,
      })
      void logPasswordResetAudit({
        outcome: "sms_sent",
        type: "sms",
        userId: profile.userId,
        phone,
        ip,
      })
    } catch (error) {
      void logPasswordResetAudit({
        outcome: "sms_send_failed",
        type: "sms",
        userId: profile.userId,
        phone,
        ip,
        detail: { error: error instanceof Error ? error.message : String(error) },
      })
      return NextResponse.json({ ok: true }, { status: 200 })
    }
    return NextResponse.json({ ok: true, method: "sms" }, { status: 200 })
  }

  if (!email) {
    void logPasswordResetAudit({
      outcome: "empty_email",
      type: "email",
      ip,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Look up user in app_users (credentials-based auth — not Supabase Auth)
  const user = await (prisma as any).appUser.findUnique({
    where: { email },
    select: { id: true },
  }).catch(() => null)

  if (!user) {
    // Don't reveal whether the email exists
    void logPasswordResetAudit({
      outcome: "email_user_not_found",
      type: "email",
      email,
      ip,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const rawToken = makeToken(32)
  const tokenHash = sha256Hex(rawToken)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60) // 1 hour

  await (prisma as any).passwordResetToken.deleteMany({
    where: { userId: user.id },
  }).catch(() => {})

  await (prisma as any).passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  })

  const resendApiKey = process.env.RESEND_API_KEY?.trim() || ""
  if (!resendApiKey) {
    console.error(
      "[password/reset/request] RESEND_API_KEY is not set — password reset emails will not be delivered. Add RESEND_API_KEY (and verify RESEND_FROM domain) in Vercel / .env.local.",
    )
    void logPasswordResetAudit({
      outcome: "email_provider_missing",
      type: "email",
      userId: user.id,
      email,
      ip,
      detail: { reason: "RESEND_API_KEY unset" },
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  let fromEmail = ""
  try {
    fromEmail = getResendFromEmail()
  } catch (error) {
    console.error("[password/reset/request] sender identity missing:", error)
    void logPasswordResetAudit({
      outcome: "email_provider_missing",
      type: "email",
      userId: user.id,
      email,
      ip,
      detail: {
        reason: error instanceof Error ? error.message : String(error),
      },
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const appBase = resolvePasswordResetAppBase(req)

  const nextPath = returnTo && returnTo.startsWith("/") ? returnTo : "/dashboard"
  const resetUrl = `${appBase}/reset-password?token=${encodeURIComponent(rawToken)}&returnTo=${encodeURIComponent(nextPath)}`
  const escapedResetUrl = escapeHtml(resetUrl)

  try {
    const { getResendClient } = await import("@/lib/resend-client")
    const { client } = getResendClient()
    const result = await client.emails.send({
      from: fromEmail,
      to: email,
      subject: "Reset your AllFantasy password",
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:20px}
  .container{max-width:520px;margin:0 auto;background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-radius:16px;padding:32px;border:1px solid #334155}
  .logo{font-size:24px;font-weight:700;background:linear-gradient(90deg,#22d3ee,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#22d3ee,#a855f7);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin:20px 0}
  .footer{color:#64748b;font-size:12px;margin-top:24px}
</style>
</head>
<body>
<div class="container">
  <div class="logo">AllFantasy.ai</div>
  <h2 style="margin:20px 0 8px;font-size:20px">Reset your password</h2>
  <p style="color:#94a3b8;margin:0 0 16px">Click the button below to set a new password. This link expires in 1 hour.</p>
  <a href="${escapedResetUrl}" class="btn">Reset Password</a>
  <p class="footer">If you didn't request a password reset, you can ignore this email. Your password will not change.</p>
  <p class="footer">© AllFantasy.ai</p>
</div>
</body>
</html>`,
    })
    if ("error" in result && result.error) {
      throw new Error(result.error.message || "Resend send error")
    }
    void logPasswordResetAudit({
      outcome: "email_sent",
      type: "email",
      userId: user.id,
      email,
      ip,
      detail: { provider: "resend", fromEmail },
    })
  } catch (error) {
    console.error("[pw-reset] email send failed:", error)
    void logPasswordResetAudit({
      outcome: "email_send_failed",
      type: "email",
      userId: user.id,
      email,
      ip,
      detail: {
        provider: "resend",
        fromEmail,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    console.error("[password/reset/request] unexpected:", err)
    return NextResponse.json({ ok: true }, { status: 200 })
  }
}

