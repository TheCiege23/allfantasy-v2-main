import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import bcrypt from "bcryptjs"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { makeToken, sha256Hex } from "@/lib/tokens"

export const runtime = "nodejs"

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function resolveSafeReturnTo(value: string | undefined): string {
  const candidate = String(value ?? "").trim()
  return candidate.startsWith("/") ? candidate : "/settings"
}

/**
 * Emails a link for the NEW address. Returns true only when the provider accepted it.
 *
 * Links issued for the previous address are NOT this function's job — they are deleted
 * inside the address-change transaction in POST, unconditionally. See the note there for
 * why this route must not copy verify-email/send's "keep older links until delivered".
 *
 * ⚠ THE SEND RESULT WAS NEVER READ. Resend resolves `{ data, error }` WITHOUT throwing
 * when it rejects an email, so a rejection returned `true`, the response said
 * `verificationEmailSent: true`, and Settings told the user to check an inbox nothing
 * had been sent to — while the undelivered token sat in the table. Measured against
 * production 2026-09-15, when every send was rejected with "API key is invalid".
 */
async function sendVerificationEmail(params: {
  userId: string
  targetEmail: string
  returnTo: string
}): Promise<boolean> {
  const { getBaseUrl } = await import("@/lib/get-base-url")
  const baseUrl = getBaseUrl()
  // Resolved before a token exists, so there is never a link nobody could be sent.
  if (!baseUrl) return false

  const rawToken = makeToken(32)
  const tokenHash = sha256Hex(rawToken)
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

  const tokenRecord = await (prisma as any).emailVerifyToken.create({
    data: { userId: params.userId, tokenHash, expiresAt },
  })

  const verifyUrl = `${baseUrl}/verify/email?token=${encodeURIComponent(rawToken)}&returnTo=${encodeURIComponent(params.returnTo)}`

  const { getResendClient, resendSendError } = await import("@/lib/resend-client")
  const { buildVerificationEmailHtml } = await import("@/lib/email/verification-email-html")
  const { buildEmailIdempotencyKey } = await import("@/lib/email/idempotency")

  let sendError: string | null = null
  try {
    const { client, fromEmail } = await getResendClient()
    const sendResult = await client.emails.send(
      {
        from: fromEmail || "AllFantasy.ai <noreply@allfantasy.ai>",
        to: params.targetEmail,
        subject: "Verify your updated email for AllFantasy.ai",
        html: buildVerificationEmailHtml({
          title: "Verify your updated email",
          greeting: "Click the button below to verify this new email address.",
          verifyUrl,
          footerNote: "If you did not request this change, secure your account immediately.",
        }),
      },
      { idempotencyKey: buildEmailIdempotencyKey("email-change", params.userId, tokenRecord.id) }
    )
    sendError = resendSendError(sendResult)
  } catch (err) {
    sendError = err instanceof Error ? err.message : "unknown error"
  }

  if (sendError) {
    // Provider message ONLY — never the recipient, token, or verification URL.
    console.error(`[user/contact/email] verification email send failed: ${sendError}`)
    await (prisma as any).emailVerifyToken.delete({ where: { id: tokenRecord.id } }).catch(() => {})
    return false
  }

  return true
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const ip = getClientIp(req)
  const rl = rateLimit(`contact-email-update:${userId}:${ip}`, 5, 10 * 60 * 1000)
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED", message: "Too many attempts. Please try again soon." }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const email = normalizeEmail(String(body?.email ?? ""))
  const currentPassword = String(body?.currentPassword ?? "")
  const returnTo = resolveSafeReturnTo(body?.returnTo)

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 })
  }

  const user = await (prisma as any).appUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, passwordHash: true },
  })
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const emailInUse = await (prisma as any).appUser.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      NOT: { id: userId },
    },
    select: { id: true },
  })
  if (emailInUse) {
    return NextResponse.json({ error: "EMAIL_ALREADY_IN_USE" }, { status: 409 })
  }

  const currentEmail = normalizeEmail(String(user.email ?? ""))
  if (currentEmail === email) {
    return NextResponse.json({ ok: true, unchanged: true, verificationEmailSent: false })
  }

  if (user.passwordHash) {
    if (!currentPassword.trim()) {
      return NextResponse.json(
        { error: "CURRENT_PASSWORD_REQUIRED", message: "Current password is required to change email." },
        { status: 400 }
      )
    }
    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!isPasswordValid) {
      return NextResponse.json({ error: "WRONG_PASSWORD", message: "Current password is incorrect." }, { status: 400 })
    }
  }

  try {
    await (prisma as any).$transaction(async (tx: any) => {
      await tx.appUser.update({
        where: { id: userId },
        data: {
          email,
          emailVerified: null,
        },
      })

      await tx.userProfile.updateMany({
        where: { userId },
        data: { emailVerifiedAt: null },
      })

      /*
       * ⚠ EVERY EXISTING LINK DIES WITH THE OLD ADDRESS — UNCONDITIONALLY, AND HERE.
       *
       * A token names the ACCOUNT, not the address it was mailed to, and /verify/email
       * marks whatever address the account holds NOW as verified. So a still-live link
       * sent to the previous address would verify the new one without the new inbox
       * ever being confirmed. That is why this route does the opposite of
       * verify-email/send, which keeps older links until a replacement is delivered:
       * there every link is for the same address; here none of the old ones are.
       *
       * Inside the transaction so it cannot be skipped separately from the change. It
       * used to run afterwards with its error swallowed, which could leave the address
       * changed and the old links alive. If it fails now, the address does not change.
       */
      await tx.emailVerifyToken.deleteMany({ where: { userId } })
    })
  } catch (err: any) {
    const code = err?.code
    if (code === "P2002") {
      return NextResponse.json({ error: "EMAIL_ALREADY_IN_USE" }, { status: 409 })
    }
    console.error("[user/contact/email] update failed:", err)
    return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 })
  }

  let verificationEmailSent = false
  try {
    verificationEmailSent = await sendVerificationEmail({
      userId,
      targetEmail: email,
      returnTo,
    })
  } catch (err) {
    // Reached only if preparing the link fails (the token write, or a module failing to
    // load); send failures are handled and logged inside sendVerificationEmail. The one
    // query that can throw here carries the account id and a token HASH — never the raw
    // token, the new address, or the verification URL.
    console.warn(
      `[user/contact/email] verification email could not be prepared: ${err instanceof Error ? err.message : "unknown error"}`
    )
  }

  return NextResponse.json({
    ok: true,
    email,
    verificationEmailSent,
  })
}
