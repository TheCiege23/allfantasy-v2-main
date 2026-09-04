import 'server-only'

import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { MINUTES } from '../domain-os/types'

/**
 * League OS — the canonical league ruleset, held briefly so one page load does not pay for it
 * repeatedly.
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-ui/*` points the other way.
 *
 * WHY THIS EXISTS SEPARATELY FROM DRAFT OS, WHICH ALREADY DECLARES THE SAME FACT.
 * `draft-os` was built around `resolveNflRedraftDraftRuntime` and calls this fact "draft rules".
 * It is not: `resolveCanonicalLeagueRules` returns the LEAGUE's ruleset — scoring, roster shape,
 * waiver and playoff settings — and four separate canonical runtime resolvers need it.
 *
 * Measured 2026-08-31, and the asymmetry is the whole reason this module exists:
 *
 *     playoff-runtime    4 routes        roster-runtime    1 route
 *     schedule-runtime   1 route         draft-runtime     0 routes
 *
 * `resolveNflRedraftDraftRuntime` — the one Draft OS was written for — has **no callers at all**.
 * Live drafts run on `lib/live-draft-engine/DraftSessionService`. So the fact was cached for the
 * only consumer that does not exist, while three that do exist paid seven uncached queries per
 * call. `resolveCanonicalLeagueRules` has no caching of its own; that was verified, not assumed.
 *
 * 🛑 SIXTY SECONDS, NOT SIX HOURS, AND THE DIFFERENCE IS NOT TIMIDITY.
 * `draft-os` gives the same fact a 6h TTL, which is right for a draft: rules do not change during
 * one, and the reader is mid-event. These are ordinary read paths a COMMISSIONER hits, and the
 * realistic sequence is "change scoring, then look at the roster screen". A 6h entry answers that
 * with the old rules and looks authoritative doing it — a worse bug than the query cost it saves.
 *
 * What a short TTL still buys is the part that actually costs: a burst. Several resolvers can each
 * reach this within one page load or one polling interval, and each was independently paying seven
 * queries. 60s collapses that to one while keeping a settings change visible inside a minute.
 *
 * ⚠ NOT A `refresh()` TARGET, AND IT MUST NOT BE ADDED TO ONE.
 * `/api/cron/domain-os-refresh` runs every 30 minutes. A 60-second entry is expired long before
 * the next fire, so scheduling it would spend the derive and warm nothing — the cron would report
 * healthy work that no read ever benefits from. Facts this short-lived are read-through by nature.
 *
 * 🛑 READ PATHS ONLY. `generateNflRedraftScheduleForSeason` and the other `generate*`/`advance*`
 * entry points take this same ruleset and PERSIST rows derived from it. A stale ruleset there does
 * not show a user an old number, it writes one into the database, where nothing later reveals that
 * the schedule was built under settings the league had already changed. Those keep calling
 * `resolveCanonicalLeagueRules` directly and are deliberately absent from this module.
 */

export type LeagueOsArgs = { leagueId: string }

/**
 * The league ruleset. One league row plus six config reads, keyed on nothing but the league —
 * which is what makes it worth holding at all, and what makes the league level correct: every
 * manager in a league gets the same answer.
 */
export const leagueRulesSource: OsFactSource<LeagueOsArgs, CanonicalLeagueRules> = {
  kind: 'rules',
  level: 'league',
  ttlMs: 1 * MINUTES,
  scopeKey: (a) => a.leagueId,
  // Sport comes from the resolved rules, not from the args, so it cannot be asserted before the
  // derive. 'NFL' matches every current consumer (all four resolvers are NFL-redraft) and is the
  // same choice draft-os made. ⚠ Revisit with D17 when a non-NFL runtime resolver appears — this
  // partitions the stored fact, so a wrong value here files it where nothing will look for it.
  sport: () => 'NFL',
  // Resolves null rather than throwing when the league is missing, per the OsFactSource contract.
  derive: (a) => resolveCanonicalLeagueRules(a.leagueId).catch(() => null),
}

export function createLeagueOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('league', deps)
}

/**
 * Shaped for the `loadRules` slot on the runtime resolvers, so the feed can be adopted without
 * touching how any of them decides anything. Only where the ruleset comes from changes.
 *
 * `drainOutcomes()` is returned alongside so a caller can report servedFrom/ageMs — the hit rate
 * is then MEASURABLE rather than assumed, which is the only honest way to decide whether this
 * layer earns its keep.
 */
export function createLeagueOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createLeagueOs(deps)
  return {
    loadRules: (leagueId: string) => feed.get(leagueRulesSource, { leagueId }),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const leagueOsSources = [leagueRulesSource] as const
