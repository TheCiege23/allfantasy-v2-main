import type { ScheduleGame } from './riScheduleCache'

const DAY_MS = 86_400_000
const LEAGUES = ['EPL', 'LALIGA', 'SERIEA'] as const

/** A Friday-to-Thursday scoring calendar, certified only by three complete 380-game league slates. */
export function deriveVerifiedSoccerCalendar(
  season: number,
  byLeague: ReadonlyMap<string, readonly ScheduleGame[]>,
): string[] | null {
  if (!Number.isInteger(season)) return null
  const starts = new Set<string>()
  for (const league of LEAGUES) {
    const games = byLeague.get(league)
    if (!games) return null
    const ids = new Set<string>()
    for (const game of games) {
      if (game.seasonType !== 'regular' || game.replacedBy ||
        String(game.status ?? '').toLowerCase() === 'replaced') continue
      if (!game.homeTeamId || !game.awayTeamId || !/^\d{4}-\d{2}-\d{2}$/.test(game.day)) return null
      const date = new Date(`${game.day}T00:00:00.000Z`)
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== game.day ||
        date.getUTCFullYear() < season || date.getUTCFullYear() > season + 1 ||
        date < new Date(`${season}-08-01T00:00:00.000Z`) ||
        date >= new Date(`${season + 1}-07-01T00:00:00.000Z`)) return null
      ids.add(game.gameId)
      const offset = (date.getUTCDay() + 2) % 7
      starts.add(new Date(date.getTime() - offset * DAY_MS).toISOString().slice(0, 10))
    }
    // Each of the three 20-club leagues plays 380 regular-season fixtures.
    if (ids.size !== 380) return null
  }
  const calendar = [...starts].sort()
  if (calendar.length !== 38 || !calendar[0]?.startsWith(`${season}-08-`) &&
    !calendar[0]?.startsWith(`${season}-09-`) ||
    !calendar[37]?.startsWith(`${season + 1}-05-`) &&
    !calendar[37]?.startsWith(`${season + 1}-06-`)) return null
  return calendar
}
