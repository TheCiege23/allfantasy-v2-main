/**
 * "Games this week" for NBA / NHL / MLB draft rosters (2026-11-19) — what a bye week is to football.
 *
 * Reads the schedule we already store (`SportsGame`); no provider is called. Two feeds can carry the
 * same game (TheSportsDB and ESPN live), so games are de-duplicated by the two teams and the day.
 * A team with no game in the window is simply absent: the roster then shows nothing, never "0".
 */
import { proTeamKey, proTeamShortCode } from './proTeamKey'

export const WEEK_GAMES_WINDOW_DAYS = 7

export interface WeekGamesEntry {
  /** Games in the next seven days. */
  games: number
  /** The soonest one: ISO start time, the opponent's short code, and whether it is at home. */
  next: { startTime: string; opponent: string | null; home: boolean } | null
}

export type WeekGamesByTeam = Record<string, WeekGamesEntry>

export interface ScheduleRow {
  homeTeam: string
  awayTeam: string
  startTime: Date | string | null
}

/** Pure: count each team's games in [now, now + 7 days) and find its next one. */
export function summarizeWeekGames(rows: readonly ScheduleRow[], sport: string, now: Date = new Date()): WeekGamesByTeam {
  const start = now.getTime()
  const end = start + WEEK_GAMES_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const seen = new Set<string>()
  const out: WeekGamesByTeam = {}
  const sorted = rows
    .map((r) => ({ ...r, t: r.startTime ? new Date(r.startTime).getTime() : NaN }))
    .filter((r) => Number.isFinite(r.t) && r.t >= start && r.t < end)
    .sort((a, b) => a.t - b.t)
  for (const row of sorted) {
    const home = proTeamKey(sport, row.homeTeam)
    const away = proTeamKey(sport, row.awayTeam)
    if (!home || !away) continue
    const day = new Date(row.t).toISOString().slice(0, 10)
    const id = `${home}|${away}|${day}`
    if (seen.has(id)) continue
    seen.add(id)
    for (const [team, opp, isHome] of [[home, away, true], [away, home, false]] as const) {
      const entry = (out[team] ??= { games: 0, next: null })
      entry.games += 1
      entry.next ??= { startTime: new Date(row.t).toISOString(), opponent: proTeamShortCode(sport, opp), home: isHome }
    }
  }
  return out
}

/** "3 games" / "1 game" for a roster row. */
export function weekGamesLabel(entry: WeekGamesEntry | null | undefined): string | null {
  if (!entry || entry.games <= 0) return null
  return `${entry.games} game${entry.games === 1 ? '' : 's'}`
}

/** "Fri vs BOS" / "Sat @ TOR" — the next game, in the viewer's time zone. */
export function nextGameShort(entry: WeekGamesEntry | null | undefined, timeZone?: string): string | null {
  const next = entry?.next
  if (!next || !next.opponent) return null
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(next.startTime))
  return `${day} ${next.home ? 'vs' : '@'} ${next.opponent}`
}

/** "Next: Fri vs BOS". */
export function nextGameLabel(entry: WeekGamesEntry | null | undefined, timeZone?: string): string | null {
  const short = nextGameShort(entry, timeZone)
  return short ? `Next: ${short}` : null
}
