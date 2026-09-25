import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sha256Hex, makeToken } from "@/lib/tokens"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const requestedReturnTo = String(body?.returnTo || "")
  const safeReturnTo = requestedReturnTo.startsWith("/") ? requestedReturnTo : "/dashboard"

  const { getSessionAndProfile } = await import("@/lib/auth-guard")
  const { userId, email } = await getSessionAndProfile()

  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  const { getClientIp, rateLimit } = await import("@/lib/rate-limit")
  const ip = getClientIp(req)
  const rl = rateLimit(`verify-email:${userId}:${ip}`, 3, 120_000)
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED", message: "Please wait before requesting another email." }, { status: 429 })
  }

  const user = await (prisma as any).appUser.findUnique({
    where: { id: userId },
    select: { emailVerified: true, email: true },
  }).catch(() => null)

  const targetEmail = user?.email ?? email
  if (!targetEmail) {
    return NextResponse.json({ error: "MISSING_EMAIL" }, { status: 400 })
  }

  if (user?.emailVerified) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }

  const recentToken = await (prisma as any).emailVerifyToken.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  }).catch(() => null)

  if (recentToken?.createdAt && Date.now() - new Date(recentToken.createdAt).getTime() < 60_000) {
    return NextResponse.json({ error: "RATE_LIMITED", message: "Please wait 60 seconds before requesting another email." }, { status: 429 })
  }

  const rawToken = makeToken(32)
  const tokenHash = sha256Hex(rawToken)
  const { emailVerifyLinkExpiresAt } = await import("@/lib/auth/emailVerifyLink")
  const expiresAt = emailVerifyLinkExpiresAt()

  /*
   * ⚠ OLDER LINKS ARE RETIRED ONLY AFTER THE NEW ONE IS DELIVERED — see the end of
   * this handler. This used to `deleteMany({ where: { userId } })` right here, before
   * the send, so a send that FAILED still destroyed the link already sitting in the
   * user's inbox: the 502 said "try again", and the email they had stopped working
   * too. Measured 2026-09-15, when production's Resend key was being rejected and
   * therefore every resend failed.
   *
   * Deferring it is safe because every stored link was mailed to the address this
   * account holds NOW: changing the address deletes them all, inside the change
   * (app/api/user/contact/email/route.ts). Until a send succeeds, the older link is
   * the only one the user can actually click.
   */
  const tokenRecord = await (prisma as any).emailVerifyToken.create({ data: { userId, tokenHash, expiresAt } })

  // Preview-aware, spoof-safe origin (mirrors the register route): a resend on a PREVIEW
  // deployment links back to the preview host so the token resolves in the preview DB;
  // production keeps the configured canonical. Never derived from a request header.
  const { getDeploymentLinkOrigin } = await import("@/lib/site-public-origin")
  const { USER_FACING_SITE_ORIGIN } = await import("@/lib/auth/user-facing-site-origin")
  const emailOrigin = getDeploymentLinkOrigin() || USER_FACING_SITE_ORIGIN
  const verifyUrl = `${emailOrigin}/verify/email?token=${encodeURIComponent(rawToken)}&returnTo=${encodeURIComponent(safeReturnTo)}`

  const { getResendClient, resendSendError } = await import("@/lib/resend-client")

  const { buildVerificationEmailHtml } = await import("@/lib/email/verification-email-html")
  const { buildEmailIdempotencyKey } = await import("@/lib/email/idempotency")

  // Resend resolves { data, error } WITHOUT throwing on a provider rejection; a thrown error
  // (missing key / network) is also possible. Treat either as a failed send so we never report
  // success for an email that did not go out.
  let sendError: string | null = null
  try {
    const { client, fromEmail } = await getResendClient()
    const sendResult = await client.emails.send(
      {
        from: fromEmail || "AllFantasy.ai <noreply@allfantasy.ai>",
        to: targetEmail,
        subject: "Verify your email for AllFantasy.ai",
        html: buildVerificationEmailHtml({
          title: "Verify your email",
          greeting: "Click the button below to verify your AllFantasy.ai email address.",
          verifyUrl,
          footerNote: "If you didn't request this, you can safely ignore this email.",
        }),
      },
      { idempotencyKey: buildEmailIdempotencyKey("email-verify-resend", userId, tokenRecord.id) }
    )
    sendError = resendSendError(sendResult)
  } catch (err) {
    sendError = err instanceof Error ? err.message : "unknown error"
  }

  if (sendError) {
    // Log the provider message ONLY — never the recipient, token, or verification URL.
    console.error(`[verify-email/send] verification email send failed: ${sendError}`)
    // The email did not go out — drop the just-created token so it is not left usable, and
    // return an honest failure instead of a false success. ONLY that token: any earlier link
    // the user already received stays valid. (Auth, cooldown, and rate limits above are
    // unchanged; a successful send still keeps its token and returns { ok: true }.)
    await (prisma as any).emailVerifyToken.delete({ where: { id: tokenRecord.id } }).catch(() => {})
    return NextResponse.json(
      { error: "EMAIL_SEND_FAILED", message: "We couldn't send the verification email right now. Please try again." },
      { status: 502 }
    )
  }

  /*
   * Delivered, so the new link supersedes the older ones. Only tokens created BEFORE this
   * one: two resends racing (two tabs, a double click past the button's guard) each run
   * this, and "everything except mine" would let each delete the other's freshly-emailed
   * link, leaving both emails dead. "Older than mine" always leaves the newest standing.
   * `id: { not }` keeps this token safe even if `createdAt` were somehow absent — Prisma
   * drops an undefined filter rather than matching nothing.
   */
  await (prisma as any).emailVerifyToken
    .deleteMany({
      where: { userId, id: { not: tokenRecord.id }, createdAt: { lt: tokenRecord.createdAt } },
    })
    .catch(() => {})

  return NextResponse.json({ ok: true })
}
