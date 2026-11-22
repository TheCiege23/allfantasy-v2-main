/**
 * The legacy Token Pool (`/api/survivor/token-pool`, `/api/survivor/token-pool/resolve`,
 * `tokenPoolEngine.ts`, table `survivor_token_pool_picks`) bridged onto the side-game Token Pool
 * (`survivorSideGameService.ts`, the side-game ledger) so a league has ONE Token Pool truth.
 *
 * Pure (no I/O; unit-tested). The legacy routes keep their request and response shapes:
 *  - a legacy `win_pick` is placed as a side-game Token Pool pick (same rules, locks and limits);
 *  - legacy reads list the side-game picks in the legacy row shape, beside the legacy rows already
 *    stored (history is never deleted);
 *  - a legacy resolve settles the side-game picks on that game (the commissioner override), and any
 *    old unresolved legacy row pays into the SAME token balance the side games use
 *    (`SurvivorPlayer.tokenBalance`), never a second one.
 */

import { sideGameKey, sideGameTeamKey, type SideGameGame } from './survivorSideGameRules'
import type { TokenPoolPickRecord } from './survivorSideGameLedger'

/**
 * Which side-game game a legacy pick or result means: the side-game key itself (`AWAY@HOME`), or —
 * for a legacy free-form game id — the ONE game this week that `team` plays in. Null when it is
 * ambiguous or unknown (never a guess).
 */
export function resolveLegacyGameKey(
  sport: string,
  games: ReadonlyArray<Pick<SideGameGame, 'key' | 'homeKey' | 'awayKey'>>,
  legacyGameId: string,
  team: string | null | undefined,
): string | null {
  const id = String(legacyGameId ?? '').trim()
  if (id && games.some((g) => g.key === id)) return id
  // "Buffalo Bills @ Kansas City Chiefs" or "BUF@KC" in any spelling.
  const parts = id.split('@')
  if (parts.length === 2) {
    const key = sideGameKey(sideGameTeamKey(sport, parts[1]), sideGameTeamKey(sport, parts[0]))
    if (games.some((g) => g.key === key)) return key
  }
  const teamKey = sideGameTeamKey(sport, team)
  if (!teamKey) return null
  const hits = games.filter((g) => g.homeKey === teamKey || g.awayKey === teamKey)
  return hits.length === 1 ? hits[0].key : null
}

/** A legacy result's winner as a side-game winner key: a team key, `tie`, or null when unreadable. */
export function legacyWinnerKey(sport: string, game: Pick<SideGameGame, 'homeKey' | 'awayKey'>, winner: unknown): string | 'tie' | null {
  if (typeof winner !== 'string' || !winner.trim()) return null
  if (winner.trim().toLowerCase() === 'tie') return 'tie'
  const key = sideGameTeamKey(sport, winner)
  return key === game.homeKey || key === game.awayKey ? key : null
}

export interface LegacyTokenPoolPickRow {
  id: string
  week: number
  sport: string
  pickType: string
  pick: Record<string, unknown>
  isCorrect: boolean | null
  tokensEarned: number
  tokensLost: number
  submittedAt: string
  /** Where the row lives: the side-game ledger (today) or the legacy table (history). */
  source: 'side_game' | 'legacy'
}

/**
 * A side-game Token Pool pick in the legacy row shape (`isCorrect`, `tokensEarned`, `tokensLost`).
 * The token movement of a wrong pick depends on the balance at settlement, so it is passed in from
 * the ledger's settlement row when known.
 */
export function sideGamePickAsLegacyRow(
  sport: string,
  pick: Pick<TokenPoolPickRecord, 'pickId' | 'week' | 'gameKey' | 'teamKey' | 'at' | 'outcome'>,
  balanceDelta?: number | null,
): LegacyTokenPoolPickRow {
  const delta = typeof balanceDelta === 'number' && Number.isFinite(balanceDelta) ? balanceDelta : pick.outcome === 'correct' ? 1 : 0
  return {
    id: pick.pickId,
    week: pick.week,
    sport,
    pickType: 'win_pick',
    pick: { gameKey: pick.gameKey, winner: pick.teamKey, team: pick.teamKey },
    isCorrect: pick.outcome == null ? null : pick.outcome === 'correct',
    tokensEarned: Math.max(0, delta),
    tokensLost: Math.max(0, -delta),
    submittedAt: pick.at,
    source: 'side_game',
  }
}

/** Newest first, one list: the side-game picks and the legacy history rows. */
export function mergeLegacyTokenPoolRows(sideGame: readonly LegacyTokenPoolPickRow[], legacy: readonly LegacyTokenPoolPickRow[], week?: number): LegacyTokenPoolPickRow[] {
  const ids = new Set(sideGame.map((r) => r.id))
  return [...sideGame, ...legacy.filter((r) => !ids.has(r.id))]
    .filter((r) => week == null || r.week === week)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || a.id.localeCompare(b.id))
}

/** The team a legacy `win_pick` names (`winner`, `team` or `teamId`). */
export function legacyPickTeam(pick: Record<string, unknown>): string | null {
  for (const k of ['winner', 'team', 'teamId']) {
    const v = pick[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}
