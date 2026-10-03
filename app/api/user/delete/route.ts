import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { releaseDeletedAccountLinks } from "@/lib/account/releaseDeletedAccountLinks"
import { revokeAllSessionsForUser } from "@/lib/auth/sessionRevocation"
import { cancelSubscriptionsOnDelete } from "@/lib/account/cancelSubscriptionsOnDelete"
import { getStripeClient } from "@/lib/stripe-client"

export const dynamic = "force-dynamic"

/**
 * POST /api/user/delete  (Release Readiness Phase 1 — blocker B1)
 *
 * Real account erasure (replaces the prior `{ stub: true }` no-op that sat behind
 * a live "delete account" button — a GDPR/CCPA right-to-erasure exposure).
 *
 * Approach: migration-free PII erasure in a transaction —
 *   - revoke authentication: delete OAuth links (AuthAccount) + verification/reset
 *     tokens, and null the password hash;
 *   - scrub personal data on AppUser (email, username, displayName, avatarUrl,
 *     emailVerified) to unrecoverable anonymized values.
 * This erases personal data while preserving referential integrity (leagues,
 * rosters, and analytics keep an anonymized user row). A full hard-delete /
 * cascade requires a schema+FK audit and is a separate, gated follow-up.
 *
 * Session note: auth uses JWT sessions, so an already-issued token cannot be
 * server-revoked without a denylist (a follow-up). The client signs out on
 * success; login is blocked immediately (password nulled, OAuth links removed,
 * identifiers anonymized).
 *
 * Requires an explicit `{ confirm: true }` body in addition to the UI's typed
 * "DELETE" confirmation — defense in depth against an accidental POST.
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let confirm = false
  try {
    const body = (await req.json()) as { confirm?: unknown } | null
    confirm = body?.confirm === true
  } catch {
    confirm = false
  }
  if (!confirm) {
    return NextResponse.json(
      { error: "Deletion requires explicit confirmation.", code: "confirmation_required" },
      { status: 400 }
    )
  }

  /*
   * Cancel billing FIRST, and refuse to erase if that fails. Erasing first and cancelling after
   * could leave an anonymized account — no email, no login — still being charged, with no way for
   * its owner to reach the billing portal. See lib/account/cancelSubscriptionsOnDelete.
   */
  let billing: Awaited<ReturnType<typeof cancelSubscriptionsOnDelete>>
  try {
    billing = await cancelSubscriptionsOnDelete(userId, {
      findSubscriptions: (id) =>
        prisma.userSubscription.findMany({
          where: { userId: id },
          select: { stripeSubscriptionId: true, stripeCustomerId: true, source: true, status: true },
        }),
      getStripe: getStripeClient,
    })
  } catch (error) {
    console.error("[user/delete] subscription cancel failed:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      {
        error:
          "We couldn't cancel your subscription, so nothing was deleted. Please try again, or cancel it in Billing first.",
        code: "subscription_cancel_failed",
      },
      { status: 502 },
    )
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.genericTradeComparison.deleteMany({ where: { userId } })
      await tx.authAccount.deleteMany({ where: { userId } })
      await tx.emailVerifyToken.deleteMany({ where: { userId } }).catch(() => undefined)
      await tx.passwordResetToken.deleteMany({ where: { userId } }).catch(() => undefined)
      await tx.appUser.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@deleted.invalid`,
          username: `deleted_${userId}`,
          passwordHash: null,
          displayName: null,
          avatarUrl: null,
          emailVerified: null,
        },
      })
      /*
       * 🛑 THE ROW ABOVE WAS ALL THIS ROUTE ERASED, AND IT WAS NOT ENOUGH. The profile kept the
       * phone, the Sleeper link, Discord/Spotify identities AND their live access tokens; the
       * unique ones (Sleeper id, phone, Discord id, platform identities) stayed OWNED by a
       * deleted account, so the same person could not link their Sleeper handle to a new
       * account and every re-import refused. Found 2026-09-28 by deleting the App Review demo
       * account. See lib/account/releaseDeletedAccountLinks.
       */
      await releaseDeletedAccountLinks(tx, userId)
    })
  } catch (error) {
    console.error("[user/delete] erasure failed:", error)
    return NextResponse.json({ error: "Account deletion failed" }, { status: 500 })
  }

  /*
   * Closes the gap the header above names ("an already-issued token cannot be server-revoked"):
   * every session this user holds is refused from now on, on every device, not only the one
   * that pressed Delete (lib/auth/sessionRevocation). Best-effort: the erasure already happened.
   */
  await revokeAllSessionsForUser(userId).catch(() => undefined)

  console.warn("[user/delete] account erased", { userId, cancelledSubscriptions: billing.cancelled.length })
  return NextResponse.json({
    ok: true,
    deleted: true,
    cancelledSubscriptions: billing.cancelled.length,
    // An App Store subscription is the user's to cancel; the client tells them where.
    appleSubscriptionActive: billing.hasAppleSubscription,
  })
}
