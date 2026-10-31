/**
 * Which college football weeks count in an NFL week, by CALENDAR (owner's decision, 2026-10-29): an NFL
 * week counts the college games played inside its window, Tuesday to the next Tuesday. A college week is
 * placed by its middle game, so it lands in exactly one NFL week and is never counted twice or skipped
 * while both seasons run. College weeks played before NFL week 1 opens (week 0 / 1) count nowhere, and
 * once the college season is over an NFL week has none: campus starters then score 0 and the pro lineup
 * decides the matchup.
 *
 * Regular season only (CFBD `seasonType: 'regular'`, which includes conference championships): the
 * weekly NCAAF scoring this reuses is regular-season only, so bowls are not counted.
 */
import type { PrismaClient } from '@prisma/client'

export type ScheduledGame = { week: number | null; startTime: Date | string | null }

const DAY = 86_400_000
/** Tuesday 08:00 UTC: after Monday night football ends in every US zone. */
const TUESDAY = 2
const BOUNDARY_HOUR_UTC = 8

function time(g: ScheduledGame): number | null {
  if (g.week == null || g.startTime == null) return null
  const t = new Date(g.startTime).getTime()
  return Number.isFinite(t) ? t : null
}

/** The Tuesday 08:00 UTC at or before `t`. */
export function weekBoundaryBefore(t: number): number {
  const d = new Date(t)
  const sameDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), BOUNDARY_HOUR_UTC)
  let back = (d.getUTCDay() - TUESDAY + 7) % 7
  if (back === 0 && t < sameDay) back = 7
  return sameDay - back * DAY
}

function byWeek(games: readonly ScheduledGame[]): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const g of games) {
    const t = time(g)
    if (t == null) continue
    out.set(g.week!, [...(out.get(g.week!) ?? []), t])
  }
  return out
}

/** NFL week → its window [start, end): from the Tuesday before its first game, seven days. */
export function nflWeekWindows(nflGames: readonly ScheduledGame[]): Map<number, { start: number; end: number }> {
  const out = new Map<number, { start: number; end: number }>()
  for (const [week, times] of byWeek(nflGames)) {
    const start = weekBoundaryBefore(Math.min(...times))
    out.set(week, { start, end: start + 7 * DAY })
  }
  return out
}

/** NFL week → the college weeks whose middle game falls in its window. */
export function cfbWeeksByNflWeek(nflGames: readonly ScheduledGame[], cfbGames: readonly ScheduledGame[]): Map<number, number[]> {
  const windows = nflWeekWindows(nflGames)
  const out = new Map<number, number[]>()
  for (const [cfbWeek, times] of byWeek(cfbGames)) {
    const sorted = [...times].sort((a, b) => a - b)
    const mid = sorted[Math.floor((sorted.length - 1) / 2)]
    for (const [nflWeek, w] of windows) {
      if (mid >= w.start && mid < w.end) {
        out.set(nflWeek, [...(out.get(nflWeek) ?? []), cfbWeek].sort((a, b) => a - b))
        break
      }
    }
  }
  return out
}

/** The college weeks that count in this NFL week of this season, from the stored schedules. */
export async function loadCfbWeeksForNflWeek(
  db: Pick<PrismaClient, 'sportsGame'>,
  args: { season: number; nflWeek: number },
): Promise<number[]> {
  const [nfl, cfb] = await Promise.all([
    // The same NFL regular-season filter the other schedule readers use (a row may carry no seasonType).
    db.sportsGame.findMany({
      where: { sport: { in: ['NFL', 'nfl'] }, season: args.season, OR: [{ seasonType: 'regular' }, { seasonType: null }] },
      select: { week: true, startTime: true },
    }),
    db.sportsGame.findMany({ where: { sport: 'NCAAF', source: 'cfbd', season: args.season, seasonType: 'regular' }, select: { week: true, startTime: true } }),
  ])
  return cfbWeeksByNflWeek(nfl, cfb).get(args.nflWeek) ?? []
}
