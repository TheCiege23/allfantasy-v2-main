/**
 * Playoff games from each source → `RookieOrderPlayoffGame[]` for the rookie order engine.
 *
 * Pure. Each adapter takes rows its caller already read and a function mapping that source's
 * team id onto the id the engine's teams use. A game whose team cannot be mapped keeps `null`
 * for that side rather than guessing — an unmapped winner is an undecided game, never a made-up
 * elimination.
 */

import type { SleeperBracketGame } from '@/lib/league-import/sleeper/bracketPlacements'
import type { RookieOrderPlayoffGame } from './rookieOrderEngine'

function positive(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Sleeper `winners_bracket` games. `p` is the placement the winner takes: `p: 1` is the title
 * game, `p: 3`/`5`/`7` are placement games between eliminated teams. Games without `p` are
 * ordinary bracket games. The losers bracket (toilet bowl) is not passed here.
 */
export function playoffGamesFromSleeperBracket(
  bracket: readonly SleeperBracketGame[],
  teamIdForRoster: (rosterId: number) => string | null,
): RookieOrderPlayoffGame[] {
  const map = (v: unknown) => {
    const id = positive(v)
    return id == null ? null : teamIdForRoster(id)
  }
  return bracket
    .filter((g) => positive(g.r) != null)
    .map((g) => {
      const p = positive(g.p)
      return {
        round: positive(g.r)!,
        kind: p != null && p > 1 ? ('placement' as const) : ('championship' as const),
        place: p != null && p > 1 ? p : null,
        teamA: map(g.t1),
        teamB: map(g.t2),
        winner: map(g.w),
      }
    })
}

export type RedraftPlayoffMatchupRow = {
  roundNumber: number
  homeRosterId: string | null
  awayRosterId: string | null
  winnerRosterId: string | null
  metadata: unknown
}

/** Rounds at or above this are consolation rounds (`CONSOLATION_ROUND_OFFSET` in the playoff runtime). */
const CONSOLATION_ROUND_OFFSET = 100

function bracketTypeOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const t = (metadata as Record<string, unknown>).bracketType
  return typeof t === 'string' ? t.toLowerCase().replace('-', '_') : null
}

/**
 * Native AllFantasy playoff matchups (`RedraftPlayoffMatchup` joined to its round's number).
 * Consolation games are dropped; a `third_place` game becomes a placement game for 3rd.
 */
export function playoffGamesFromRedraftMatchups(
  rows: readonly RedraftPlayoffMatchupRow[],
  teamIdForRoster: (redraftRosterId: string) => string | null = (id) => id,
): RookieOrderPlayoffGame[] {
  const map = (id: string | null) => (id ? teamIdForRoster(id) : null)
  return rows
    .filter((r) => bracketTypeOf(r.metadata) !== 'consolation' && r.roundNumber < CONSOLATION_ROUND_OFFSET)
    .map((r) => {
      const third = bracketTypeOf(r.metadata) === 'third_place'
      return {
        round: r.roundNumber,
        kind: third ? ('placement' as const) : ('championship' as const),
        place: third ? 3 : null,
        teamA: map(r.homeRosterId),
        teamB: map(r.awayRosterId),
        winner: map(r.winnerRosterId),
      }
    })
}
