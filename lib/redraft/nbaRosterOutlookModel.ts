/**
 * The pure half of the NBA week outlook (./nbaRosterOutlook.ts): which game is a player's next one in
 * the fantasy week, and the fantasy points a box-score line is worth for ranking defenses.
 *
 * An NBA fantasy week holds several games per club, so unlike the NFL there is no single "the game":
 * the screen shows the NEXT one not yet started (or the last one, once all have tipped off) and how
 * many the club plays in the week.
 */
import { nbaTeamKey } from '@/lib/roster-lineup-engine/lineupLockService'

export type NbaWeekGame = { homeTeam: string | null; awayTeam: string | null; startTime: Date | null }

export type NbaNextGame = {
  /** Folded club code of the opponent ("PHX"). */
  opponent: string
  /** The opponent as the schedule names it ("Phoenix Suns"), for its crest. */
  opponentName: string | null
  home: boolean
  at: Date
  /** The club's games in the week. */
  gamesThisWeek: number
}

/** The club's next game in the week at `now` — or its last, once every game has started. Null with none. */
export function nbaNextGame(games: readonly NbaWeekGame[], team: string | null | undefined, now: Date): NbaNextGame | null {
  const key = nbaTeamKey(team)
  if (!key) return null
  const mine = games
    .filter((g) => g.startTime && (nbaTeamKey(g.homeTeam) === key || nbaTeamKey(g.awayTeam) === key))
    .sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime())
  if (mine.length === 0) return null
  const pick = mine.find((g) => g.startTime!.getTime() >= now.getTime()) ?? mine[mine.length - 1]!
  const home = nbaTeamKey(pick.homeTeam) === key
  return {
    opponent: nbaTeamKey(home ? pick.awayTeam : pick.homeTeam),
    opponentName: (home ? pick.awayTeam : pick.homeTeam) ?? null,
    home,
    at: pick.startTime!,
    gamesThisWeek: mine.length,
  }
}

/**
 * A box-score line's standard fantasy points: points 1, rebounds 1.2, assists 1.5, steals 3, blocks 3,
 * turnovers -1.
 *
 * Used ONLY to rank defenses against a position, where the order matters and a league's own weights
 * would barely move it. `player_game_stats.fantasyPoints` cannot be used: every NBA row stores 0
 * (measured 2026-11-24, 9,019 of 9,019 lines for 2026), so the line is priced from its own counts.
 */
export function nbaRankingPoints(stats: Record<string, unknown> | null | undefined): number | null {
  if (!stats || typeof stats !== 'object') return null
  const n = (k: string) => {
    const v = Number((stats as Record<string, unknown>)[k])
    return Number.isFinite(v) ? v : 0
  }
  if (!('points' in stats)) return null
  return n('points') + 1.2 * n('total_rebounds') + 1.5 * n('assists') + 3 * n('steals') + 3 * n('blocks') - n('turnovers')
}

/** A position as the NBA ranks it: the first of a combined listing ("SG-SF" → "SG"); "G"/"F" stay as they are. */
export function nbaPrimaryPosition(position: string | null | undefined): string {
  return String(position ?? '').toUpperCase().split(/[-/,\s]+/)[0] ?? ''
}

export const NBA_RANKED_POSITIONS: ReadonlySet<string> = new Set(['PG', 'SG', 'SF', 'PF', 'C'])
