import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-guard"
import { prisma } from "@/lib/prisma"
import { buildRateLimit429, consumeRateLimit } from "@/lib/rate-limit"
import { withdrawSmsConsent } from "@/lib/sms/smsConsent"

export const dynamic = "force-dynamic"

/**
 * DELETE /api/user/phone — remove the phone number from the account (Settings › Security).
 *
 * ⚠ REFUSED WHEN THE PHONE IS THE ACCOUNT'S ONLY VERIFICATION. "Verified" means
 * `AppUser.emailVerified` OR a verified phone (isUserVerified in lib/auth-guard); removing the phone from an account whose
 * email was never verified would silently drop it out of every `requireVerifiedUser` route. The
 * refusal says what to do instead.
 *
 * The SMS consent record is kept and marked withdrawn, not deleted. Consent is per number
 * (lib/sms/smsConsent), so a record left live would cover this same number again the day it is
 * re-added without the opt-in box — exactly the "texts only to people who opted in" promise the
 * A2P campaign makes.
 */
export async function DELETE() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const rl = consumeRateLimit({
    scope: "user",
    action: "phone_remove",
    sleeperUsername: auth.userId,
    maxRequests: 10,
    windowMs: 15 * 60_000,
  })
  if (!rl.success) {
    return NextResponse.json(buildRateLimit429({ message: "Too many attempts — try again in a few minutes.", rl }), {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSec) },
    })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.appUser.findUnique({ where: { id: auth.userId }, select: { emailVerified: true } })
      const profile = await tx.userProfile.findUnique({
        where: { userId: auth.userId },
        select: { phone: true, phoneVerifiedAt: true, notificationPreferences: true },
      })
      if (!profile?.phone && !profile?.phoneVerifiedAt) return "none" as const
      // The SAME field the gate reads (getUserEmailVerification) — not UserProfile.emailVerifiedAt,
      // which `requireVerifiedUser` never consults.
      if (profile.phoneVerifiedAt && !user?.emailVerified) return "only_verification" as const
      await tx.userProfile.update({
        where: { userId: auth.userId },
        data: {
          phone: null,
          phoneVerifiedAt: null,
          notificationPreferences: withdrawSmsConsent(profile.notificationPreferences, "phone_removed") as never,
        },
      })
      return "removed" as const
    })

    if (result === "only_verification") {
      return NextResponse.json(
        {
          error: "PHONE_IS_ONLY_VERIFICATION",
          message: "Your phone is how this account is verified. Verify your email first, then you can remove the phone.",
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, removed: result === "removed" })
  } catch {
    return NextResponse.json({ error: "Your phone number could not be removed. Please try again." }, { status: 503 })
  }
}
