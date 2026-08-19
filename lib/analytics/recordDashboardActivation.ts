/**
 * First meaningful dashboard activation.
 *
 * ACTIVATION MEANS: the first successful authenticated load of the canonical dashboard
 * (`/dashboard`, the Nocturne cut-over) in which the user actually received usable league
 * context — at least one AF-created or imported league.
 *
 * What that deliberately excludes, because none of them is a person successfully using
 * the product:
 *   - a route request or prefetch (this is called from the success path only, after the
 *     server has resolved real data)
 *   - a loading, permission, error, or DashboardUnavailableState render
 *   - a league prefetch that FAILED — `getDashboardLeagueListForUser` is wrapped in
 *     `.catch(() => null)` at the call site, so null means "we could not tell", which is
 *     not the same as "this user has no leagues" and must never be counted either way
 *   - a successful load showing ZERO leagues. That screen is an onboarding prompt asking
 *     the user to import something; the product promise is "I always know what needs my
 *     attention", and with no leagues there is nothing to attend to. Counting it would
 *     make every campaign look like it activated users it merely signed up.
 *
 * Native and imported leagues share one definition on purpose: the list this reads
 * already merges `League` and imported `LegacyLeague` rows, so an imported-only user
 * activates exactly like an AF-native one. Imports are the primary product motion; a
 * definition that excluded them would report the launch as failing.
 *
 * IDEMPOTENCY — no migration required. Uniqueness is enforced by looking for a prior
 * `acquisition.dashboard_activated` row for this user, the same mechanism already proven
 * by linkAttributionToUser. AnalyticsEvent is indexed on (userId) and (event, createdAt),
 * so this is an indexed lookup, and activation is a once-per-user event whose write path
 * runs at most once per user for the lifetime of the account. A dedicated schema column
 * would buy a marginally tighter race guarantee at the cost of a migration this phase is
 * not authorized to make.
 */
import { prisma } from "@/lib/prisma"

import { touchToMeta } from "@/lib/analytics/attribution"
import { readAttributionState } from "@/lib/analytics/attributionCookies"
import { ACQUISITION, ANALYTICS_TOOL_PRODUCT } from "@/lib/analytics/eventNames"

export type ActivationResult =
  | { status: "recorded" }
  | { status: "skipped"; reason: "already_activated" | "no_usable_league_context" | "context_unavailable" }
  | { status: "failed" }

export type ActivationInput = {
  /** From the server session only. Never a client-supplied value. */
  userId: string
  /**
   * The resolved dashboard league list, or null when the prefetch failed.
   * Null and `[]` mean different things and are handled differently.
   */
  leagueCount: number | null
  getCookie: (name: string) => string | undefined
}

export async function recordDashboardActivation(input: ActivationInput): Promise<ActivationResult> {
  try {
    if (input.leagueCount === null) return { status: "skipped", reason: "context_unavailable" }
    if (input.leagueCount < 1) return { status: "skipped", reason: "no_usable_league_context" }

    // Scoped to userId alone — activation is first-ever, not per-device. This is what stops
    // /dashboard and /dashboard/v2 (and repeat visits) from double-counting: whichever
    // surface loads first records it, and every later load finds this row.
    const existing = await prisma.analyticsEvent.findFirst({
      where: { event: ACQUISITION.DASHBOARD_ACTIVATED, userId: input.userId },
      select: { id: true },
    })
    if (existing) return { status: "skipped", reason: "already_activated" }

    const { anonId, firstTouch, latestTouch } = readAttributionState(input.getCookie)

    await prisma.analyticsEvent.create({
      data: {
        event: ACQUISITION.DASHBOARD_ACTIVATED,
        toolKey: ANALYTICS_TOOL_PRODUCT,
        userId: input.userId,
        sessionId: anonId,
        meta: {
          league_count: input.leagueCount,
          ...(firstTouch ? touchToMeta(firstTouch, "first") : {}),
          ...(latestTouch ? touchToMeta(latestTouch, "latest") : {}),
          // Separates "activated with no campaign" from "activated, campaign unknown
          // because cookies were cleared between signup and activation".
          has_attribution: Boolean(firstTouch || latestTouch),
        },
      },
    })

    return { status: "recorded" }
  } catch {
    // Never throws: this runs inside the dashboard render path and must not be able to
    // turn a working dashboard into an error page.
    return { status: "failed" }
  }
}
