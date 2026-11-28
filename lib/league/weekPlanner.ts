import { dailyTeamCode } from '@/lib/core-app/dailyNextGames'
import { normalizeLockTeam } from '@/lib/redraft/lineupLock'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'

/**
 * "Games this week" — the streaming planner for the daily sports (2026-11-27).
 *
 * In weekly head-to-head hockey, basketball and baseball the number of games a player gets in the
 * league's week decides more matchups than talent: a 4-game skater outscores a better 2-game one.
 * Hockey managers leaving Yahoo's late-2026 redesign stream around exactly this, and an NHL
 * games-per-week read existed (`/api/nhl-schedule/volume`) that no screen ever showed.
 *
 * This is the pure half: fixtures in, one row per team out (its opponent each day, games this week,
 * games still to play), plus each day's slate size so a LIGHT night — few games, so a streamer who
 * plays that night has little competition for a lineup spot — stands out. The fixtures come from the
 * same reads the lineup lock and the week finalizer use (weekPlannerLoad.ts), so the planner's week
 * is the league's scoring week, not a guess at one.
 */

export type PlannerFixture = {
  home: string | null
  away: string | null
  /** Display names when the codes are opaque (soccer team ids). */
  homeLabel?: string | null
  awayLabel?: string | null
  start: Date | null
  /** Eastern day `YYYY-MM-DD` when the source already says it (the RI schedule). */
  day?: string | null
}

export type PlannerGame = { day: string; opponent: string; home: boolean; started: boolean }

export type PlannerTeam = {
  team: string
  label: string
  games: PlannerGame[]
  /** Games in the week. */
  count: number
  /** Games not yet started. */
  remaining: number
  /** Of `remaining`, how many fall on a light night. */
  lightRemaining: number
}

export type PlannerDay = {
  day: string
  /** Games on the slate that day (each game once). */
  games: number
  status: 'past' | 'today' | 'future'
  /** Few games league-wide: fewest third of the week's game days, and at most half the busiest. */
  light: boolean
}

export type WeekPlanner = {
  sport: string
  week: number
  days: PlannerDay[]
  teams: PlannerTeam[]
}

const DAY_MS = 86_400_000

/** A team as the planner keys it — the same rule the fixtures were keyed by. */
export function plannerTeamCode(sport: string, team: string | null | undefined): string | null {
  const s = sport.toUpperCase()
  if (s === 'SOCCER') return String(team ?? '').trim() || null
  return dailyTeamCode(s, team) ?? (normalizeLockTeam(s, team) || null)
}

export function buildWeekPlanner(args: {
  sport: string
  week: number
  window: { start: Date; end: Date }
  fixtures: readonly PlannerFixture[]
  now: Date
}): WeekPlanner | null {
  const sport = args.sport.toUpperCase()
  const dayKeys: string[] = []
  for (let t = args.window.start.getTime(); t < args.window.end.getTime(); t += DAY_MS) {
    dayKeys.push(new Date(t).toISOString().slice(0, 10))
  }
  if (dayKeys.length === 0) return null
  const today = easternCalendarDay(args.now)?.toISOString().slice(0, 10) ?? null
  const now = args.now.getTime()

  // One fixture per (day, home, away): feeds that double-list a game must not give a team two.
  const seen = new Set<string>()
  const perDay = new Map<string, number>(dayKeys.map((d) => [d, 0]))
  const teams = new Map<string, PlannerTeam>()
  const team = (c: string, label: string) => {
    let t = teams.get(c)
    if (!t) teams.set(c, (t = { team: c, label, games: [], count: 0, remaining: 0, lightRemaining: 0 }))
    return t
  }

  for (const f of args.fixtures) {
    const home = plannerTeamCode(sport, f.home)
    const away = plannerTeamCode(sport, f.away)
    const day = f.day ?? easternCalendarDay(f.start)?.toISOString().slice(0, 10) ?? null
    if (!home || !away || home === away || !day || !perDay.has(day)) continue
    const key = `${day}|${home}|${away}`
    if (seen.has(key)) continue
    seen.add(key)
    perDay.set(day, perDay.get(day)! + 1)
    // A game counts as started from its start time; with none, from the end of its day.
    const started = f.start ? f.start.getTime() <= now : Date.parse(`${day}T00:00:00Z`) + DAY_MS <= now
    const homeLabel = sport === 'SOCCER' ? String(f.homeLabel ?? home) : home
    const awayLabel = sport === 'SOCCER' ? String(f.awayLabel ?? away) : away
    team(home, homeLabel).games.push({ day, opponent: awayLabel, home: true, started })
    team(away, awayLabel).games.push({ day, opponent: homeLabel, home: false, started })
  }
  if (teams.size === 0) return null

  const counts = dayKeys.map((d) => perDay.get(d)!).filter((n) => n > 0)
  const busiest = Math.max(0, ...counts)
  const sorted = [...counts].sort((a, b) => a - b)
  const lightCut = sorted[Math.max(0, Math.floor(sorted.length / 3) - 1)] ?? 0
  const days: PlannerDay[] = dayKeys.map((d) => {
    const games = perDay.get(d)!
    return {
      day: d,
      games,
      status: !today ? 'future' : d < today ? 'past' : d === today ? 'today' : 'future',
      light: games > 0 && counts.length >= 3 && games <= lightCut && games * 2 <= busiest,
    }
  })
  const lightDays = new Set(days.filter((d) => d.light).map((d) => d.day))

  for (const t of teams.values()) {
    t.games.sort((a, b) => a.day.localeCompare(b.day))
    t.count = t.games.length
    const open = t.games.filter((g) => !g.started)
    t.remaining = open.length
    t.lightRemaining = open.filter((g) => lightDays.has(g.day)).length
  }

  return {
    sport,
    week: args.week,
    days,
    teams: [...teams.values()].sort(
      (a, b) => b.remaining - a.remaining || b.lightRemaining - a.lightRemaining || b.count - a.count || a.label.localeCompare(b.label),
    ),
  }
}
