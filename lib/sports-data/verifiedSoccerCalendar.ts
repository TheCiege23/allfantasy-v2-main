import type { ScheduleGame } from './riScheduleCache'

const DAY_MS = 86_400_000
const LEAGUES = ['EPL', 'LALIGA', 'SERIEA'] as const
/** A row in one of these states is not the date the fixture is played on. */
const CALLED_OFF = new Set(['postponed', 'abandoned', 'cancelled', 'canceled', 'suspended'])

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
    // One row per fixture. A double round robin plays each home/away pairing once, so the pairing IS
    // the fixture; the vendor's game id carries the date and changes when a game moves.
    const fixtures = new Map<string, { day: string; rank: number }>()
    for (const game of games) {
      if (game.seasonType !== 'regular') continue
      const status = String(game.status ?? '').toLowerCase()
      const replaced = Boolean(game.replacedBy) || status === 'replaced'
      const date = new Date(`${game.day}T00:00:00.000Z`)
      const sound = Boolean(game.homeTeamId && game.awayTeamId) && /^\d{4}-\d{2}-\d{2}$/.test(game.day) &&
        Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === game.day &&
        date >= new Date(`${season}-08-01T00:00:00.000Z`) &&
        date < new Date(`${season + 1}-07-01T00:00:00.000Z`)
      // A row the vendor has retired may be malformed; a live one may not.
      if (!sound) {
        if (replaced) continue
        return null
      }
      /*
       * 🛑 A MOVED GAME IS LISTED MORE THAN ONCE, AND COUNTING ROWS REFUSED THE CALENDAR FOR WEEKS.
       * Three shapes, all in production's stored schedule of 2026-11-02, and no calendar was ever stored:
       *  - a postponed game keeps its old row (`postponed`, no `replaced_by`) beside its new date:
       *    Levante v Athletic Club on 09-16 and on 10-21, so La Liga counted 381;
       *  - a rescheduled game sits on both dates for a few days before the old row turns `replaced`;
       *  - two rows `replaced` by EACH OTHER (Aston Villa v Fulham, 10-31 and 11-01), which dropped the
       *    fixture altogether, so the EPL counted 379.
       * So the unit is the fixture, and the row kept for it is the best one there is: still on or
       * played, then called off, then retired; the later date within a rank.
       */
      const key = `${game.homeTeamId}|${game.awayTeamId}`
      const rank = replaced ? 0 : CALLED_OFF.has(status) ? 1 : 2
      const kept = fixtures.get(key)
      if (!kept || rank > kept.rank || (rank === kept.rank && game.day > kept.day)) fixtures.set(key, { day: game.day, rank })
    }
    // Each of the three 20-club leagues plays 380 regular-season fixtures.
    if (fixtures.size !== 380) return null
    for (const { day } of fixtures.values()) {
      const date = new Date(`${day}T00:00:00.000Z`)
      const offset = (date.getUTCDay() + 2) % 7
      starts.add(new Date(date.getTime() - offset * DAY_MS).toISOString().slice(0, 10))
    }
  }
  const calendar = [...starts].sort()
  if (calendar.length !== 38 || !calendar[0]?.startsWith(`${season}-08-`) &&
    !calendar[0]?.startsWith(`${season}-09-`) ||
    !calendar[37]?.startsWith(`${season + 1}-05-`) &&
    !calendar[37]?.startsWith(`${season + 1}-06-`)) return null
  return calendar
}
