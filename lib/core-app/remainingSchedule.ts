/**
 * Your games left this season, for a league's Schedule tab (2026-11-13 follow-up).
 *
 * The owner's point: a schedule page has to answer "who do I play the rest of the way?" — and the tab made
 * you step the week picker one week at a time to find out. Every future pairing is already stored:
 * Sleeper publishes the whole regular season into `WeeklyMatchup` at 0-0, and a `matchupId` pairs the two
 * rosters of a game (the same rows Standings' "unplayed" games and its odds are built from).
 *
 * The pure part decides what a "game left" is and how hard it looks; `loadYourGamesLeft` is the read.
 */
import type { WeekRow } from '@/lib/core-app/standingsModel'

export type GameLeft = {
  week: number
  opponentId: string
  opponentName: string
  /** The opponent's record as the platform reports it; null when not on file. */
  record: { wins: number; losses: number; ties: number } | null
  /** In the top third of the league by win share — a game to plan for. */
  tough: boolean
}

type TeamRecordRow = { rosterId: string; name: string | null; wins: number; losses: number; ties: number }

const isScored = (r: Pick<WeekRow, 'pointsFor' | 'pointsAgainst'>) => r.pointsFor > 0 || r.pointsAgainst > 0

/**
 * Your unplayed games after `afterWeek` and before `beforeWeek` (the playoffs, when known), soonest first.
 *
 * ⚠ BOTH ROWS OF A GAME MUST BE UNSCORED. A week the platform is finishing has one side on the board;
 * that game is being played, not "left".
 *
 * ⚠ "TOUGH" NEEDS A RECORD TO RANK. With no games played league-wide, everyone is 0-0 and nobody is marked.
 */
export function yourGamesLeft(input: {
  rows: ReadonlyArray<WeekRow>
  myRosterIds: ReadonlyArray<string>
  afterWeek: number
  beforeWeek?: number | null
  teams: ReadonlyArray<TeamRecordRow>
}): GameLeft[] {
  const mine = new Set(input.myRosterIds.map(String))
  if (mine.size === 0) return []
  const byGame = new Map<string, WeekRow[]>()
  for (const r of input.rows) {
    if (r.matchupId == null) continue
    if (r.week <= input.afterWeek) continue
    if (input.beforeWeek != null && r.week >= input.beforeWeek) continue
    const key = `${r.week}:${r.matchupId}`
    byGame.set(key, [...(byGame.get(key) ?? []), r])
  }
  const teamById = new Map(input.teams.map((t) => [String(t.rosterId), t]))
  const played = (t: TeamRecordRow) => t.wins + t.losses + t.ties
  const share = (t: TeamRecordRow) => (played(t) > 0 ? (t.wins + t.ties / 2) / played(t) : null)
  const shares = input.teams.map(share).filter((x): x is number => x != null).sort((a, b) => b - a)
  // The share the top third of the league reaches; a team at or above it (and above .500) is "tough".
  const cut = shares.length >= 3 ? shares[Math.max(0, Math.ceil(shares.length / 3) - 1)]! : null

  const out: GameLeft[] = []
  for (const g of byGame.values()) {
    if (g.length !== 2 || g.some(isScored)) continue
    const me = g.find((r) => mine.has(String(r.rosterId)))
    const them = g.find((r) => !mine.has(String(r.rosterId)))
    if (!me || !them) continue
    const t = teamById.get(String(them.rosterId)) ?? null
    const s = t ? share(t) : null
    out.push({
      week: me.week,
      opponentId: String(them.rosterId),
      opponentName: t?.name?.trim() || `Team ${them.rosterId}`,
      record: t && played(t) > 0 ? { wins: t.wins, losses: t.losses, ties: t.ties } : null,
      tough: cut != null && s != null && s >= cut && s > 0.5,
    })
  }
  return out.sort((a, b) => a.week - b.week)
}
