/**
 * Universal League Hub — recommendation contract (Part 4).
 *
 * This phase deliberately does NOT implement recommendations. It defines the
 * canonical, domain-shaped contract every league entry exposes so future OS
 * modules (Lineup OS, Waiver OS, Trade OS, Roster/Rankings, Commissioner OS)
 * can populate it without changing the shape the League Hub already renders.
 *
 * Distinct from, and not a replacement for, `lib/decision-os/phase6/recommendations/types.ts`
 * (a tier-based manager/commissioner/platform DNA-recommendation engine already
 * shipped). That engine answers "what should this manager/league/platform do
 * about engagement, retention, trade activity, etc." This contract answers a
 * narrower question: "does this specific league have a pending lineup / waiver
 * / trade / roster / commissioner action right now." A future phase may bridge
 * the two; this phase does not assume that bridge exists yet.
 */
import type { LeagueRecommendationBundle, LeagueRecommendationDomain } from './types'

export const LEAGUE_RECOMMENDATION_DOMAINS: readonly LeagueRecommendationDomain[] = [
  'lineup',
  'waiver',
  'trade',
  'roster',
  'playoff',
  'strategy',
  'commissioner',
]

/**
 * User OS phase — domains this program's coordinator actually populates
 * today. `commissioner` is deliberately excluded: it stays part of the
 * shared contract (reserved for the Commissioner OS successor phase) but
 * this coordinator never writes to it.
 */
export const USER_OS_DOMAINS: readonly LeagueRecommendationDomain[] = [
  'lineup',
  'waiver',
  'trade',
  'roster',
  'playoff',
  'strategy',
]

/** Every League Hub entry gets this until a real OS module populates it. Never fabricated counts. */
export function getEmptyRecommendationBundle(): LeagueRecommendationBundle {
  return {
    lineup: [],
    waiver: [],
    trade: [],
    roster: [],
    playoff: [],
    strategy: [],
    commissioner: [],
    totalCount: 0,
  }
}
