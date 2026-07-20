import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { prisma } from '@/lib/prisma'
import {
  GUEST_SESSION_COOKIE_NAME,
  verifyGuestSessionToken,
} from '@/lib/guest-mode/guestSessionToken'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'

/**
 * The single authorization gate for legacy routes that operate on a Sleeper account.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Legacy routes historically took a `sleeper_username` straight from the request body
 * and selected that user's leagues, rosters and owners from it. Anyone could read
 * anyone's data by naming them.
 *
 * The obvious-looking fixes are all no-ops, which is why this is centralised rather
 * than hand-rolled per route:
 *
 *   - `requireAuthOrOrigin(req)` from `@/lib/api-auth` returns
 *     `{ authenticated: true, user: null }` for a fully anonymous caller whenever the
 *     `origin`/`referer` header check passes — headers the caller sets — and that check
 *     returns `true` unconditionally outside production. It is a CSRF speed-bump
 *     wearing an auth-shaped name.
 *   - `requireAuth(req)` from `@/lib/api-auth` resolves the `af_session` cookie. The
 *     cookie is properly HMAC-signed, but it is minted by `POST /api/legacy/session`
 *     from a `sleeper_username` that is NEVER verified. Signing stops tampering; it
 *     does not stop lying at mint time.
 *   - Both NAME-COLLIDE with `@/lib/auth-guard`'s real `requireAuth()`. The arity is
 *     the only tell: `requireAuth()` is real, `requireAuth(req)` is not.
 *
 * ── WHAT IT PROVES, AND WHAT IT CANNOT ───────────────────────────────────────
 * Sleeper has no OAuth, so ownership of a handle cannot be proven by anyone. This
 * downgrades "anonymous, unlimited, unattributable enumeration of any user's leagues"
 * to "act only as the handle already linked to your own account, attributably and
 * rate-limited". That is a large reduction, not a closed door — describe it that way.
 *
 * ── THE TWO ACCEPTED IDENTITIES ──────────────────────────────────────────────
 * 1. A NextAuth session, resolved to a username through the SERVER-MANAGED
 *    `AppUser -> LegacyUser` link. That link is exclusive: `linkAfUserToLegacy` 409s if
 *    another account already claimed the legacy user. Deliberately NOT
 *    `UserProfile.sleeperUsername`, which the schema marks a mutable display handle —
 *    keying on it reintroduces the hole.
 * 2. OPTIONALLY (`allowGuest`), a signed `af_guest_session` JWT. `guest-import` creates
 *    `LegacyUser` rows with no `AppUser`, so guests have no NextAuth session; requiring
 *    one would lock them out of data they just imported. The token is signed and carries
 *    its own `legacyUserId` + `sleeperUsername`, so it is a real binding, not a claim.
 *    Only pass `allowGuest` for routes a guest legitimately uses on their OWN data —
 *    never for cross-user or commissioner surfaces.
 *
 * The caller-supplied username is never used to select data. It is only compared, so a
 * stale client fails loudly (403) instead of silently receiving someone else's view.
 */

export type LegacyIdentity = {
  /** The authorization key. Always server-derived — never from the request body. */
  sleeperUsername: string
  /** Stable id for rate-limit keying and attribution. */
  actorId: string
  source: 'session' | 'guest'
}

/**
 * Remaining per-actor budget, surfaced on success so a route can keep returning the
 * `rate_limit` block its clients already read (af-legacy's rank counter, for one). Without
 * this, moving a hand-rolled limiter into the gate silently nulls that UI.
 */
export type LegacyRateLimitBudget = { remaining: number; retryAfterSec: number }

export type LegacyIdentityResult =
  | { ok: true; identity: LegacyIdentity; rateLimit?: LegacyRateLimitBudget }
  | { ok: false; response: NextResponse }

export type RequireLegacyIdentityOptions = {
  /**
   * Accept a signed guest session in addition to a NextAuth session. Only for routes a
   * guest legitimately uses on their own imported data.
   */
  allowGuest?: boolean
  /**
   * A username the caller supplied (body or query). Never used to select data — only
   * rejected with 403 when it disagrees with the resolved identity.
   */
  requestedUsername?: string | null
  /** Per-actor rate limit applied AFTER identity resolves, so floods can't drain it. */
  rateLimit?: { action: string; maxRequests: number; windowMs: number }
}

function json(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status })
}

export async function requireLegacySleeperIdentity(
  req: NextRequest,
  options: RequireLegacyIdentityOptions = {},
): Promise<LegacyIdentityResult> {
  const { allowGuest = false, requestedUsername = null, rateLimit } = options

  let identity: LegacyIdentity | null = null

  // ── 1. NextAuth session ────────────────────────────────────────────────────
  const auth = await requireAuth()
  if (auth.ok) {
    const appUser = await prisma.appUser.findUnique({
      where: { id: auth.userId },
      select: { legacyUser: { select: { sleeperUsername: true } } },
    })
    const linked = appUser?.legacyUser?.sleeperUsername ?? ''
    if (!linked) {
      // Authenticated but no Sleeper account linked. Distinct from 401/403 so the
      // client can prompt "link your Sleeper account" instead of "log in".
      return {
        ok: false,
        response: json(409, 'No Sleeper account is linked to this login. Import your leagues first.', {
          code: 'SLEEPER_NOT_LINKED',
        }),
      }
    }
    identity = { sleeperUsername: linked, actorId: auth.userId, source: 'session' }
  }

  // ── 2. Signed guest session ────────────────────────────────────────────────
  if (!identity && allowGuest) {
    const token = req.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value ?? null
    const guest = await verifyGuestSessionToken(token)
    if (guest) {
      identity = {
        sleeperUsername: guest.sleeperUsername,
        actorId: `guest:${guest.legacyUserId}`,
        source: 'guest',
      }
    }
  }

  if (!identity) {
    return {
      ok: false,
      response: json(401, allowGuest
        ? 'Sign in, or import your leagues as a guest, to use this.'
        : 'Sign in to use this.'),
    }
  }

  // ── 3. Reject a disagreeing caller-supplied username ───────────────────────
  const requested = (requestedUsername ?? '').trim()
  if (requested && requested.toLowerCase() !== identity.sleeperUsername.toLowerCase()) {
    return {
      ok: false,
      response: json(403, 'You can only act on your own linked Sleeper account.', {
        code: 'SLEEPER_USERNAME_MISMATCH',
      }),
    }
  }

  // ── 4. Per-actor rate limit, after the gate ────────────────────────────────
  let budget: LegacyRateLimitBudget | undefined
  if (rateLimit) {
    /*
     * Keyed on `actorId`, with the client IP folded in via `includeIpInKey`. That flag
     * is load-bearing rather than decorative: `consumeRateLimit` only incorporates the
     * IP when it is set, so passing `ip` without it produces ONE bucket shared by the
     * entire deployment that still reads like a per-caller limit.
     */
    const rl = consumeRateLimit({
      scope: 'legacy',
      action: rateLimit.action,
      sleeperUsername: identity.actorId, // param is legacy-named; any stable actor id works
      ip: getClientIp(req),
      includeIpInKey: true,
      maxRequests: rateLimit.maxRequests,
      windowMs: rateLimit.windowMs,
    })
    if (!rl.success) {
      return {
        ok: false,
        response: NextResponse.json(
          buildRateLimit429({ message: 'Slow down a moment and try again.', rl }),
          { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
        ),
      }
    }
    budget = { remaining: rl.remaining ?? 0, retryAfterSec: rl.retryAfterSec ?? 0 }
  }

  return { ok: true, identity, rateLimit: budget }
}
