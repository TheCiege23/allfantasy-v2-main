import { prisma } from '@/lib/prisma'
import { linkAfUserToLegacy } from '@/lib/legacy/linkAfUserToLegacy'
import { verifyGuestSessionToken } from '@/lib/guest-mode/guestSessionToken'

/**
 * Why a claim didn't happen. All non-`claimed` outcomes are non-errors from the
 * caller's perspective — the common case (`no-token`) is simply "this sign-in
 * had no pending trial to migrate."
 */
export type GuestClaimResult =
  | { claimed: true; legacyUserId: string }
  | {
      claimed: false
      reason: 'no-user' | 'no-token' | 'invalid-token' | 'legacy-missing' | 'already-linked' | 'conflict' | 'error'
    }

/**
 * Idempotently migrate a guest's no-login Sleeper import (the `LegacyUser` and,
 * transitively, all its imported `LegacyLeague`/`LegacyRoster`/history rows) onto
 * an authenticated `AppUser`.
 *
 * This is the single migration seam behind AF_GATE0 §3.5 ("claim the trial payload
 * → attach imported leagues/history to the new userId"). It is deliberately callable
 * from every account-creation path — email/password register AND OAuth/social sign-in
 * (via NextAuth `events.signIn`) — so no signup path drops the trial data.
 *
 * Idempotency (§3.5 "replaying migration must not duplicate leagues"):
 *  - The claim is a single FK write (`AppUser.legacyUserId`), not a copy — replaying
 *    it re-points the same FK, never duplicating leagues.
 *  - If the user is already linked, we short-circuit before any write (also avoids
 *    re-running rank recompute on every subsequent login).
 *  - `linkAfUserToLegacy` guards the unique FK: if another AppUser already claimed
 *    this LegacyUser we return `conflict` instead of stealing it.
 *
 * Never throws — a failure here must never block sign-in.
 *
 * @param userId    the authenticated AppUser id to attach the trial data to
 * @param guestToken the raw `af_guest_session` cookie value (or null/undefined)
 */
export async function claimGuestTrialForUser(
  userId: string,
  guestToken: string | null | undefined,
): Promise<GuestClaimResult> {
  try {
    if (!userId) return { claimed: false, reason: 'no-user' }

    const guest = await verifyGuestSessionToken(guestToken)
    if (!guest) {
      return { claimed: false, reason: guestToken ? 'invalid-token' : 'no-token' }
    }

    // Already linked? Cheap short-circuit — no writes, no rank recompute. Makes the
    // helper safe to call on EVERY sign-in (events.signIn fires on each login).
    const existing = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { legacyUserId: true },
    })
    if (existing?.legacyUserId) {
      return { claimed: false, reason: 'already-linked' }
    }

    const legacyUser = await prisma.legacyUser.findUnique({
      where: { id: guest.legacyUserId },
      select: {
        id: true,
        sleeperUsername: true,
        sleeperUserId: true,
        displayName: true,
        avatar: true,
        avatarUrl: true,
      },
    })
    // Cookie verified but the LegacyUser row is gone (e.g. purged) — nothing to claim.
    if (!legacyUser) return { claimed: false, reason: 'legacy-missing' }

    const linked = await linkAfUserToLegacy(userId, {
      id: legacyUser.id,
      sleeperUsername: legacyUser.sleeperUsername,
      sleeperUserId: legacyUser.sleeperUserId,
      displayName: legacyUser.displayName,
      avatar: legacyUser.avatar,
      avatarUrl: legacyUser.avatarUrl,
      isNew: false,
      usernameChanged: false,
    })
    if (!linked.ok) {
      // 409 — this Sleeper account is already tied to a different AF login.
      return { claimed: false, reason: 'conflict' }
    }

    return { claimed: true, legacyUserId: legacyUser.id }
  } catch (err) {
    console.warn('[claimGuestTrialForUser] non-fatal:', err)
    return { claimed: false, reason: 'error' }
  }
}
