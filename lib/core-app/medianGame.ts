/**
 * The weekly median game of an IMPORTED league — PURE, client-safe.
 *
 * Sleeper's `settings.league_average_match = 1` adds a second game to every regular-season week: a
 * win for finishing in the top half of that week's scores, a loss otherwise. It is in the platform's
 * own record (standingsModel.ts measured 524 of 526 teams in 40 median leagues matching "head-to-head
 * + median"), so a record or a projection that leaves it out disagrees with Sleeper by up to a game a
 * week.
 *
 * (AllFantasy-native leagues carry their own `League.medianGame` and are scored by
 * `lib/redraft/medianGame.ts`; this module is for rows read from `WeeklyMatchup`.)
 *
 * ── Is it on? ──────────────────────────────────────────────────────────────
 *
 * The stated setting wins when it is there. The Sleeper import only began storing
 * `league_average_match` with this module, so a league imported earlier says nothing — and for those
 * the platform's own records are the evidence: a median league has played about twice as many games
 * as weeks gone by. That is the test `lib/trade-value/pickSlotProjection.ts` (`gamesPerWeekFrom`)
 * already applies, with one more guard: a record more than a week AHEAD of two games a week is not
 * this season's (a stale full-season record read against week 1 would otherwise look like a median
 * league), so it proves nothing.
 */

import type { Record3 } from './standingsModel'

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const KEYS = ['league_average_match', 'medianGame', 'median_game'] as const

/** True / false when the league's settings say; null when they do not mention it. */
export function statedMedianGame(settings: unknown): boolean | null {
  const s = object(settings)
  const blocks = [s, object(s.sleeper), object(s.league), object(s.sleeperLeague)]
  for (const b of blocks) {
    for (const k of KEYS) {
      const v = b[k]
      if (v === undefined || v === null) continue
      if (v === true || v === 1 || v === '1' || v === 'true') return true
      if (v === false || v === 0 || v === '0' || v === 'false') return false
    }
  }
  return null
}

/**
 * `reported`: the most games (W + L + T) any team's platform record shows, and how many weeks of
 * this season are final. Null when the platform reports no records.
 */
export function leagueHasMedianGame(
  settings: unknown,
  reported: { maxGames: number; weeksDone: number } | null,
): boolean {
  const stated = statedMedianGame(settings)
  if (stated != null) return stated
  if (!reported || !(reported.weeksDone > 0) || !(reported.maxGames > 0)) return false
  const { maxGames, weeksDone } = reported
  return maxGames >= 1.5 * weeksDone && maxGames <= 2 * weeksDone + 2
}

/**
 * Median-game records from scored rows, one week at a time — the same rule `advanceWeek` in
 * standingsModel.ts applies: the top half of the week's scored field wins; with an odd field the
 * middle team is below the line; level scores straddling the line are a median tie. A week with
 * fewer than two scored rows has no median.
 *
 * The caller decides which rows count (scored, final, regular season).
 */
export function medianGameRecords(
  rows: ReadonlyArray<{ week: number; rosterId: string; pointsFor: number }>,
): Map<string, Record3> {
  const byWeek = new Map<number, Map<string, number>>()
  for (const r of rows) {
    const week = byWeek.get(r.week) ?? new Map<string, number>()
    // One row per roster per week is the table's key; keep the first if a caller passes more.
    if (!week.has(r.rosterId)) week.set(r.rosterId, r.pointsFor)
    byWeek.set(r.week, week)
  }
  const out = new Map<string, Record3>()
  for (const week of byWeek.values()) {
    const m = week.size
    if (m < 2) continue
    const sorted = [...week.values()].sort((x, y) => y - x)
    const half = Math.floor(m / 2)
    const lastIn = sorted[half - 1]
    const firstOut = sorted[half]
    for (const [id, pts] of week) {
      const rec = out.get(id) ?? { wins: 0, losses: 0, ties: 0 }
      if (lastIn === firstOut && pts === lastIn) rec.ties += 1
      else if (pts >= lastIn) rec.wins += 1
      else rec.losses += 1
      out.set(id, rec)
    }
  }
  return out
}
