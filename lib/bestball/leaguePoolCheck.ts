/**
 * The best ball pool check (./poolCapacity.ts) for an EXISTING league, at the commissioner saves that
 * can make it fail: a new team count (league settings), new starter seats (roster settings), or best
 * ball lineups switched on for a Guilly league (Guilly rules). Pure — the caller has already read the
 * league row; nothing here touches the DB or a provider.
 */
import { buildBestBallSlots } from '@/lib/bestball/productionLineup'
import { lineupSetsItself } from '@/lib/guillotine/guillotineBestBall'
import { checkBestBallPoolCapacity, settingsWithRosterSlots, type BestBallPoolCheck } from './poolCapacity'

export type PoolCheckLeague = {
  sport: string | null
  settings: unknown
  bestBallMode?: boolean | null
  leagueVariant?: string | null
  leagueType?: string | null
  guillotineMode?: boolean | null
}

/**
 * Null when the league's lineups do not set themselves (nothing to check) — unless `assumeBestBall`,
 * for the save that is about to switch best ball on. `rosterSlots` is a roster editor's proposed slot
 * map; without it the league's current seats are read exactly as scoring reads them.
 */
export function checkLeagueBestBallPool(
  league: PoolCheckLeague,
  change: { teamCount: number; rosterSlots?: Record<string, number> | null; assumeBestBall?: boolean },
): BestBallPoolCheck | null {
  if (!change.assumeBestBall && !lineupSetsItself(league)) return null
  const sport = String(league.sport ?? 'NFL').toUpperCase()
  const settings = change.rosterSlots ? settingsWithRosterSlots(change.rosterSlots) : league.settings
  return checkBestBallPoolCapacity({ sport, teamCount: change.teamCount, slots: buildBestBallSlots(sport, settings) })
}

/** The refusal body every save returns, so the editors show one shape. */
export function bestBallPoolRefusalBody(check: BestBallPoolCheck) {
  return {
    error: check.refusals[0]?.message ?? 'This league is too large for the player pool.',
    code: 'BEST_BALL_POOL_EXHAUSTED' as const,
    refusals: check.refusals.map((r) => r.message),
  }
}
