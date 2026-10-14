import type { SeasonBlueprint } from './seasonBlueprint'
import { assessSeasonRules } from './seasonRules'

export type CalendarGame = { gameId: string; day?: string; startTime: string | null; seasonType: 'regular' | 'pre' | 'post' | null; status: string | null; replacedBy: string | null }
export type CalendarCoverage = {
  ready: boolean; blockers: string[]; warnings: string[]; regularGames: number; pendingGames: number
  periods: Array<{ number: number; games: number }>
  assignments: Array<{ gameId: string; startsAt: string; period: number | null }>
  excludedGames: Array<{ gameId: string; startsAt: string }>
}

/** Validate the published provider slate, not merely the commissioner's acknowledgement. */
export function assessSeasonCalendar(config: SeasonBlueprint, games: CalendarGame[]): CalendarCoverage {
  const blockers = [...assessSeasonRules(config).blockers]
  const warnings: string[] = []
  const result: CalendarCoverage = { ready: false, blockers, warnings, regularGames: 0, pendingGames: 0, periods: [], assignments: [], excludedGames: [] }
  if (!config.rules) return result
  const calendar = config.rules.calendar
  const active = games.filter(g => !g.replacedBy && !/^(replaced|cancelled|canceled)$/i.test(g.status ?? ''))
  if (active.some(g => g.seasonType === null)) blockers.push('The provider has games with unknown season types. Resolve their classification before publication.')
  const regular = active.filter(g => g.seasonType === 'regular')
  const unique = new Map<string, CalendarGame>()
  for (const game of regular) {
    const previous = unique.get(game.gameId)
    if (previous && previous.startTime !== game.startTime) blockers.push(`Game ${game.gameId} has conflicting start times.`)
    unique.set(game.gameId, game)
  }
  result.regularGames = unique.size
  const expected = config.sport === 'NBA' ? 1230 : 272
  const minimum = config.sport === 'NBA' ? 1200 : 272
  if (unique.size < minimum || unique.size > expected) blockers.push(`The provider must contain ${config.sport === 'NBA' ? '1200–1230' : '272'} distinct regular-season games; received ${unique.size}.`)
  result.pendingGames = Math.max(0, expected - unique.size)
  if (result.pendingGames && config.sport === 'NBA') warnings.push(`${result.pendingGames} Cup-dependent regular-season games are not yet in the provider schedule. Their times must be rechecked before scoring opens.`)
  const periods = [...calendar.periods].sort((a, b) => a.number - b.number)
  result.periods = periods.map(p => ({ number: p.number, games: 0 }))
  const starts = periods.map(p => Date.parse(p.startsAt)), ends = periods.map(p => Date.parse(p.endsAt))
  const from = starts[0]!, to = ends[ends.length - 1]!
  for (const game of [...unique.values()].sort((a, b) => a.gameId.localeCompare(b.gameId))) {
    const time = game.startTime ? Date.parse(game.startTime) : NaN
    // Flex times outside the tournament (for example NFL week 18) need not block a week-17 final.
    const day = game.day ? Date.parse(game.day + 'T12:00:00Z') : NaN
    if (!Number.isFinite(time) && Number.isFinite(day) && (day < from - 86400000 || day >= to + 86400000)) continue
    if (!Number.isFinite(time)) { blockers.push(`Game ${game.gameId} has no confirmed start time.`); continue }
    if (time < Date.parse(calendar.regularSeasonStartsAt) || time >= Date.parse(calendar.regularSeasonEndsAt)) blockers.push(`Game ${game.gameId} falls outside the declared regular-season bounds.`)
    if (time < from || time >= to) continue
    const matches = periods.flatMap((p, i) => time >= starts[i]! && time < ends[i]! ? [i] : [])
    if (matches.length > 1) { blockers.push(`Game ${game.gameId} belongs to overlapping periods.`); continue }
    const i = matches[0]
    result.assignments.push({ gameId: game.gameId, startsAt: game.startTime!, period: i === undefined ? null : periods[i]!.number })
    if (i === undefined) result.excludedGames.push({ gameId: game.gameId, startsAt: game.startTime! })
    else {
      result.periods[i]!.games++
      // A scheduled tipoff is not a completed game. Reserve conservative game-duration headroom.
      const durationHours = config.sport === 'NBA' ? 4 : 6
      if (ends[i]! < time + durationHours * 3600000) blockers.push(`Period ${periods[i]!.number} ends too close to game ${game.gameId}; reserve ${durationHours} hours after its start.`)
    }
  }
  for (const period of result.periods) if (!period.games) blockers.push(`Period ${period.number} has no scheduled regular-season games.`)
  if (result.excludedGames.length) warnings.push(`${result.excludedGames.length} scheduled games fall in gaps between scoring periods and will not count. Explicit acknowledgement is required.`)
  result.blockers = [...new Set(blockers)]
  result.ready = result.blockers.length === 0
  return result
}
