import 'server-only'

import { latestProjectionWeek, lookupProjections, type PlayerProjection } from '@/lib/core-app/playerProjections'
import { computeLeagueProjectedPoints, hasScoringRules, NO_LEAGUE_SCORING_REASON } from '@/lib/projections/leagueScoring'
import type { ImpactPlayer } from './rosterImpact'
import { scoringRulesFrom } from './scoringContextFromWorld'

/**
 * Lineup points for ONE league: this week's projection, scored under that league's own rulebook.
 *
 * ── 🛑 WHY NOT `AFProjectionSnapshot.afProjection` ─────────────────────────────────────────────
 * That per-game figure is written in ONE format, full PPR, whatever the league scores
 * (`AF_SNAPSHOT_SCORING_FORMAT`). Measured on production 2026-09-17: of 290 Sleeper NFL leagues,
 * 33 do not score a full point per reception, 184 carry a TE premium, and a "full PPR, no TE
 * premium" gate would keep 89 — 36 of which still score passing touchdowns differently. The user's
 * standing decision for a generic number under a "your league" label is to REFUSE (league-view
 * scoring audit, #949), and the user chose this basis for trade lineups on 2026-09-17.
 *
 * So a lineup number here is the vendor's weekly component line re-scored by
 * `computeLeagueProjectedPoints` — the basis My Team and the matchup tabs already use — and a league
 * this cannot price is refused BY NAME, never priced generically.
 *
 * ⚠ ONE WEEK. Right for a start/sit; only part of the answer for a trade or an add, and every
 * surface that renders it says which week.
 *
 * ⚠ NFL ONLY. `latestProjectionWeek` and the weekly feed are the NFL's.
 *
 * Used by the trade evaluator's lineup impact and by Chimmy's start/sit and waiver scenarios, so
 * the three cannot drift onto different bases.
 */

/** The feed's season and week — from the data, never a clock. */
export type LeagueWeek = { season: string; week: number }

export type WeekLine = Pick<PlayerProjection, 'position' | 'componentStats'>

export interface LeagueWeekPricingDeps {
  latestWeek: () => Promise<LeagueWeek | null>
  /** That week's component lines for these ids, with defensive lines added when the league scores IDP. */
  loadWeekLines: (args: {
    week: LeagueWeek
    playerIds: string[]
    rules: Record<string, unknown>
    positions: ReadonlyMap<string, string | null>
  }) => Promise<ReadonlyMap<string, WeekLine>>
}

export const defaultLeagueWeekPricingDeps: LeagueWeekPricingDeps = {
  latestWeek: latestProjectionWeek,
  loadWeekLines: ({ week, playerIds, rules, positions }) =>
    lookupProjections(playerIds, week, { scoringSettings: rules, positionBySleeperId: positions }, 'NFL'),
}

export type LeagueWeekBasis = { rules: Record<string, unknown>; week: LeagueWeek }
export type LeagueWeekRefusalReason = 'sport_not_supported' | 'no_scoring_rules' | 'no_projection_week'
export type LeagueWeekRefusal = { refuse: LeagueWeekRefusalReason; detail: string }

/** The league's rulebook and the feed's week — or why nothing can be priced here. */
export async function leagueWeekBasis(
  league: { sport: string | null | undefined; scoringSettings: unknown },
  deps: Pick<LeagueWeekPricingDeps, 'latestWeek'> = defaultLeagueWeekPricingDeps,
): Promise<LeagueWeekBasis | LeagueWeekRefusal> {
  if (String(league.sport ?? '').trim().toUpperCase() !== 'NFL') {
    return {
      refuse: 'sport_not_supported',
      detail: 'lineup numbers are computed for NFL leagues only: the weekly projection feed they are priced from is the NFL’s',
    }
  }
  const rules = scoringRulesFrom(league.scoringSettings)
  if (!rules || !hasScoringRules(rules)) return { refuse: 'no_scoring_rules', detail: NO_LEAGUE_SCORING_REASON }
  const week = await deps.latestWeek().catch(() => null)
  if (!week) return { refuse: 'no_projection_week', detail: 'no weekly projection feed is on file, so no lineup can be priced' }
  return { rules, week }
}

export const isLeagueWeekRefusal = (b: LeagueWeekBasis | LeagueWeekRefusal): b is LeagueWeekRefusal => 'refuse' in b

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Each id priced for the basis week under the league's rules.
 *
 * 🛑 NULL, NEVER ZERO, WHEN IT CANNOT BE. A missing line, a line the rules match nothing in, or a
 * failed read all leave the player unpriced; `computeRosterImpact` blocks on an unpriced MOVED player
 * and discloses an unpriced bench one.
 */
export async function priceLeagueWeek(
  basis: LeagueWeekBasis,
  ids: readonly string[],
  positions: ReadonlyMap<string, string | null>,
  deps: Pick<LeagueWeekPricingDeps, 'loadWeekLines'> = defaultLeagueWeekPricingDeps,
): Promise<Map<string, ImpactPlayer>> {
  const unique = [...new Set(ids)]
  const lines = await deps
    .loadWeekLines({ week: basis.week, playerIds: unique, rules: basis.rules, positions })
    .catch(() => new Map() as ReadonlyMap<string, WeekLine>)
  const out = new Map<string, ImpactPlayer>()
  for (const id of unique) {
    const line = lines.get(id)
    const scored = line?.componentStats ? computeLeagueProjectedPoints(line.componentStats, basis.rules) : null
    out.set(id, {
      playerId: id,
      position: String(positions.get(id) ?? line?.position ?? '').toUpperCase(),
      projectedPoints: scored ? round2(scored.points) : null,
    })
  }
  return out
}
