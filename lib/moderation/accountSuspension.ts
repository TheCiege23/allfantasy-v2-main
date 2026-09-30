import { prisma } from "@/lib/prisma"
import { revokeAllSessionsForUser } from "@/lib/auth/sessionRevocation"
import { logAdminAudit } from "@/lib/admin-audit"

/**
 * Suspending or banning an account — the enforcement half of the moderation queue.
 *
 * 🛑 THE QUEUE COULD REMOVE A MESSAGE BUT NOT THE PERSON WHO POSTED IT. App Store guideline 1.2
 * asks an app with user-generated content for a way to act on abusive USERS, and the Terms (§11)
 * promise ejection. `PlatformModerationAction` (warning / mute / suspend / ban) has existed since
 * the init migration, and `lib/moderation/UserModerationService` wrote to it — but nothing read
 * it: no sign-in path, no session, no route consulted a ban. This module is the read, the write,
 * and the two places the read is enforced (lib/auth.ts).
 *
 * No migration: the table is in production (0 rows, 2026-09-30).
 *
 * Enforcement, and why it is enough:
 *  - Sign-in is refused for a restricted account, on every path: the password provider throws
 *    ACCOUNT_SUSPENDED (only AFTER the password matched, so it discloses nothing to someone
 *    without it), and every social provider funnels through `runSocialLink`, which returns the
 *    /auth/error URL instead of linking.
 *  - Sessions already open end at once: `revokeAllSessionsForUser` is the sign-out mechanism, and
 *    the jwt callback throws on a revoked token, which clears the cookie.
 *  With no session there is nothing left to post from, so no chat route needs its own check.
 *
 * ⚠ A read failure lets the sign-in through. Refusing everyone because the moderation table was
 * unreachable would lock out every user to stop one; the revocation already ended that one's
 * sessions.
 */

export const ACCOUNT_SUSPENDED_ERROR = "ACCOUNT_SUSPENDED"
export const ACCOUNT_SUSPENDED_ERROR_URL = `/auth/error?error=${ACCOUNT_SUSPENDED_ERROR}`

export type AccountRestriction = {
  kind: "suspend" | "ban"
  /** When a suspension ends; null for a ban, or a suspension with no end. */
  until: Date | null
  reason: string | null
}

/** The account's current suspension or ban, or null. A ban always counts; a suspension until it expires. */
export async function activeAccountRestriction(
  userId: string,
  now: Date = new Date(),
): Promise<AccountRestriction | null> {
  if (!userId) return null
  try {
    const row = await prisma.platformModerationAction.findFirst({
      where: {
        userId,
        OR: [
          { actionType: "ban" },
          { actionType: "suspend", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { actionType: true, expiresAt: true, reason: true },
    })
    if (!row) return null
    return {
      kind: row.actionType === "ban" ? "ban" : "suspend",
      until: row.actionType === "ban" ? null : row.expiresAt,
      reason: row.reason,
    }
  } catch (err) {
    console.error("[moderation] account restriction read failed; allowing sign-in:", err)
    return null
  }
}

export type RestrictAccountInput = {
  userId: string
  kind: "suspend" | "ban"
  /** Suspension length. Ignored for a ban. Omitted -> a suspension with no end date. */
  days?: number | null
  reason?: string | null
  adminUserId: string
  now?: Date
}

/** Suspend or ban, then end every open session. Throws if the account does not exist. */
export async function restrictAccount(input: RestrictAccountInput): Promise<AccountRestriction> {
  const now = input.now ?? new Date()
  const user = await prisma.appUser.findUnique({ where: { id: input.userId }, select: { id: true } })
  if (!user) throw new Error("USER_NOT_FOUND")

  const expiresAt =
    input.kind === "suspend" && input.days != null && input.days > 0
      ? new Date(now.getTime() + input.days * 86_400_000)
      : null
  const reason = input.reason?.trim() || null

  await prisma.platformModerationAction.create({
    data: {
      userId: input.userId,
      actionType: input.kind,
      reason,
      expiresAt,
      createdByUserId: input.adminUserId,
    },
  })
  await revokeAllSessionsForUser(input.userId)
  await logAdminAudit({
    adminUserId: input.adminUserId,
    action: input.kind === "ban" ? "user_ban" : "user_suspend",
    targetType: "user",
    targetId: input.userId,
    details: { reason, expiresAt: expiresAt?.toISOString() ?? null },
  })
  return { kind: input.kind, until: expiresAt, reason }
}

/** Lift every suspension and ban on the account. Returns how many were removed. */
export async function liftAccountRestriction(userId: string, adminUserId: string): Promise<number> {
  const { count } = await prisma.platformModerationAction.deleteMany({
    where: { userId, actionType: { in: ["suspend", "ban"] } },
  })
  await logAdminAudit({ adminUserId, action: "user_restriction_lift", targetType: "user", targetId: userId, details: { removed: count } })
  return count
}
