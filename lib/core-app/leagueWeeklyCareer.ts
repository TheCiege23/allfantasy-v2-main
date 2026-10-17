/**
 * League Career from weekly team scores — the pure half, for leagues with no head-to-head history.
 *
 * ⚠ WHY A SECOND SOURCE, AND WHY NOT A WIN-LOSS RECORD. `getLeagueCareer` reads `MatchupFact`,
 * which is a FIXTURE table: `teamA` against `teamB`. Measured on production 2026-10-01, 22 live
 * Sleeper leagues have no rows there and never will — 18 are guillotine/elimination leagues, where
 * there is no opponent, and Sleeper's matchups endpoint answers with no pairing to store. Those
 * leagues DO carry every team's weekly score in `team_performances`. So this reads what a week
 * actually is in those formats — a score against the whole field — and reports it as that:
 * points, where that score finished among the teams that played, and, in an elimination league,
 * how long you lasted. It never manufactures a W-L record out of ranks.
 *
 * ⚠ A ZERO IS NOT A SCORE. In an elimination league a chopped team scores 0 every week after it
 * goes, and in any league a week not yet played is a row of zeros. A zero is therefore never
 * ranked: the field for a week is the teams that scored, and a week nobody scored is not a week.
 * Your own zero after weeks of scoring is the elimination, in an elimination league; elsewhere it
 * is a week you did not play, and it is skipped rather than ranked last.
 */

export type WeeklyCareerFormat = 'elimination' | 'scores'

export type WeeklyScoreRow = {
  /** `LeagueTeam.externalId` — the same slot key `MatchupFact` uses. */
  slot: string
  season: number
  week: number
  points: number
}

export type WeeklySeasonLine = {
  season: number
  /** Weeks you scored in and that are final. */
  weeks: number
  pointsFor: number
  /** Weeks your score was the highest in the field. */
  topScores: number
  /** Weeks your score was the lowest in the field. In an elimination league, the week that chopped you. */
  bottomScores: number
  /** Mean finish across your scored weeks, 1 = top score. */
  averageFinish: number
  bestFinish: number
  /** The most teams that scored in any final week of the season. */
  fieldSize: number
  /**
   * Elimination only: the last week you scored before the field went on without you — the week that
   * chopped you, since the lowest score is cut AFTER its week is played. Null while still alive.
   */
  choppedAfterWeek: number | null
}

export type WeeklyCareer = {
  format: WeeklyCareerFormat
  seasons: WeeklySeasonLine[]
  totals: { weeks: number; pointsFor: number; topScores: number; averageFinish: number | null }
  firstSeason: number
  lastSeason: number
}

export function buildWeeklyCareer(input: {
  rows: readonly WeeklyScoreRow[]
  mySlots: ReadonlySet<string>
  format: WeeklyCareerFormat
  isFinal: (season: number, week: number) => boolean
}): WeeklyCareer | null {
  const { rows, mySlots, format, isFinal } = input

  // season → week → slot → points (the largest row wins if a slot is duplicated).
  const grid = new Map<number, Map<number, Map<string, number>>>()
  for (const r of rows) {
    if (!Number.isFinite(r.points) || !isFinal(r.season, r.week)) continue
    const weeks = grid.get(r.season) ?? new Map<number, Map<string, number>>()
    const slots = weeks.get(r.week) ?? new Map<string, number>()
    slots.set(r.slot, Math.max(slots.get(r.slot) ?? 0, r.points))
    weeks.set(r.week, slots)
    grid.set(r.season, weeks)
  }

  const seasons: WeeklySeasonLine[] = []
  for (const season of [...grid.keys()].sort((a, b) => a - b)) {
    const line: WeeklySeasonLine = {
      season,
      weeks: 0,
      pointsFor: 0,
      topScores: 0,
      bottomScores: 0,
      averageFinish: 0,
      bestFinish: 0,
      fieldSize: 0,
      choppedAfterWeek: null,
    }
    let finishSum = 0
    let lastScoredWeek: number | null = null
    const weeks = grid.get(season)!
    for (const week of [...weeks.keys()].sort((a, b) => a - b)) {
      const field = [...weeks.get(week)!.entries()].filter(([, p]) => p > 0)
      if (field.length === 0) continue // nobody scored: not a week
      line.fieldSize = Math.max(line.fieldSize, field.length)

      const mine = field.filter(([slot]) => mySlots.has(slot)).map(([, p]) => p)
      if (mine.length === 0) {
        if (format === 'elimination' && lastScoredWeek != null && line.choppedAfterWeek == null) {
          line.choppedAfterWeek = lastScoredWeek
        }
        continue
      }
      if (line.choppedAfterWeek != null) continue // a stray score after the chop is not a comeback

      const my = Math.max(...mine)
      const finish = 1 + field.filter(([, p]) => p > my).length
      line.weeks += 1
      lastScoredWeek = week
      line.pointsFor += my
      finishSum += finish
      if (finish === 1) line.topScores += 1
      if (finish === field.length && field.length > 1) line.bottomScores += 1
      line.bestFinish = line.bestFinish === 0 ? finish : Math.min(line.bestFinish, finish)
    }
    if (line.weeks === 0) continue
    line.averageFinish = finishSum / line.weeks
    seasons.push(line)
  }

  if (seasons.length === 0) return null

  const weeks = seasons.reduce((n, s) => n + s.weeks, 0)
  return {
    format,
    seasons,
    totals: {
      weeks,
      pointsFor: seasons.reduce((n, s) => n + s.pointsFor, 0),
      topScores: seasons.reduce((n, s) => n + s.topScores, 0),
      averageFinish: weeks > 0 ? seasons.reduce((n, s) => n + s.averageFinish * s.weeks, 0) / weeks : null,
    },
    firstSeason: seasons[0].season,
    lastSeason: seasons[seasons.length - 1].season,
  }
}
