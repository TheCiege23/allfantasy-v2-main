import 'server-only'

import { headers } from 'next/headers'

import { prisma } from '@/lib/prisma'
import { isSpeculativeRequestHeaders } from '@/lib/http/speculativeRequest'

/**
 * Record that a human opened this league. The DEMAND signal for the historical-refresh rotation.
 *
 * ── 🛑 THIS CANNOT RUN BEFORE ITS MIGRATION IS APPLIED ───────────────────────────────────────
 *
 * `League.lastViewedAt` is declared in `schema.prisma` and its migration is PARKED in
 * `prisma/migrations-pending/20260901210000_league_last_viewed_at/`. Until that is applied,
 * every League read in the repo fails with P2022 — not just this one — because Prisma selects
 * every declared scalar unless a query names an explicit `select`, and there are 827 League
 * reads. Apply first, deploy second. The reverse takes the product down.
 *
 * ── ⚠ THE PREFETCH GUARD IS INSIDE THIS FUNCTION, NOT LEFT TO THE CALLER ────────────────────
 *
 * Next prefetches every league link that scrolls into view. Writing on those would mark a whole
 * league list as "viewed" while the user was merely scrolling past it, turning the demand signal
 * into a restatement of what is on screen — the ordering would then look principled and rank by
 * nothing.
 *
 * This repo already paid for that lesson in the other direction: the middleware stamped
 * `af_lang=es` for a year on a prefetch of the language switch, so first-time English visitors
 * were switched to Spanish without clicking anything. Same header, same mistake, different cost.
 * Putting the check here rather than at the call site means a second caller cannot forget it.
 *
 * ── FIRE AND FORGET, DELIBERATELY ────────────────────────────────────────────────────────────
 *
 * A page render must never fail, slow down, or block on recording a view. Every error is
 * swallowed. The consequence of losing a write is that one league is ordered slightly less
 * eagerly for a while, which is invisible; the consequence of throwing is a blank page.
 */

/**
 * How long one league stays "recently recorded" in this process.
 *
 * A single page can issue several server renders, and a user re-opening the same league within
 * minutes tells the rotation nothing it does not already know. Five minutes collapses that
 * without losing anything the ordering can act on — the rotation fires every four hours.
 */
const TOUCH_THROTTLE_MS = 5 * 60_000
const TOUCH_MEMO_MAX = 1_000
const recentlyTouched = new Map<string, number>()

/** Test seam — the memo is process-global. */
export function __clearLeagueViewedThrottle(): void {
  recentlyTouched.clear()
}

/** Decide whether this render should record a view. Pure, so both branches are testable. */
export function shouldRecordView(args: {
  leagueId: string | null | undefined
  isSpeculative: boolean
  lastTouchedAt: number | null
  now: number
}): boolean {
  if (!args.leagueId) return false
  if (args.isSpeculative) return false
  if (args.lastTouchedAt !== null && args.now - args.lastTouchedAt < TOUCH_THROTTLE_MS) return false
  return true
}

export async function touchLeagueViewed(leagueId: string | null | undefined): Promise<void> {
  try {
    const h = await headers()
    const now = Date.now()
    const key = String(leagueId ?? '')

    if (
      !shouldRecordView({
        leagueId,
        isSpeculative: isSpeculativeRequestHeaders(h),
        lastTouchedAt: recentlyTouched.get(key) ?? null,
        now,
      })
    ) {
      return
    }

    // Recorded BEFORE the write, so a slow or failing update cannot cause a stampede of retries
    // from concurrent renders of the same page.
    if (recentlyTouched.size >= TOUCH_MEMO_MAX) {
      const oldest = recentlyTouched.keys().next().value
      if (oldest !== undefined) recentlyTouched.delete(oldest)
    }
    recentlyTouched.set(key, now)

    /*
     * `updateMany`, not `update`: `update` throws when the row is absent, and a league id that
     * no longer exists is an ordinary race (deleted between render and write), not an error
     * worth surfacing. `updateMany` reports zero rows and moves on.
     */
    await prisma.league.updateMany({
      where: { id: key },
      data: { lastViewedAt: new Date(now) },
    })
  } catch {
    // Never let recording a view affect the page. See the header.
  }
}
