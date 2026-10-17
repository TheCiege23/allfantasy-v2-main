import type { CalendarCoverage, CalendarGame } from './seasonCalendarCoverage'
import type { SeasonRules } from './seasonRules'
import { scoringPeriodForGame } from './seasonRules'

type FrozenAssignment = CalendarCoverage['assignments'][number]
export type SeasonScheduleChange = {
  gameId: string
  kind: 'missing' | 'conflict' | 'replaced' | 'canceled' | 'postponed' | 'unverified' | 'rescheduled' | 'new_game'
  publishedStartsAt: string | null
  currentScheduledAt: string | null
  publishedPeriod: number | null
  currentScheduledPeriod: number | null
  status: string | null
  replacedBy: string | null
}

/** Schedule-only drift preview. Neither provider game_time nor this report proves actual tipoff. */
export function compareSeasonScheduleDrift(rules: SeasonRules, published: FrozenAssignment[], current: CalendarGame[]) {
  const firstWindow = Math.min(...rules.calendar.periods.map(period => Date.parse(period.startsAt)))
  const lastWindow = Math.max(...rules.calendar.periods.map(period => Date.parse(period.endsAt)))
  const original = new Map<string, FrozenAssignment>()
  for (const game of published) {
    if (original.has(game.gameId)) throw new Error('Published calendar has duplicate game IDs.')
    original.set(game.gameId, game)
  }
  const byId = new Map<string, CalendarGame[]>()
  for (const game of current) byId.set(game.gameId, [...(byId.get(game.gameId) ?? []), game])
  const changes: SeasonScheduleChange[] = []
  const add = (gameId: string, kind: SeasonScheduleChange['kind'], prior: FrozenAssignment | undefined, next: CalendarGame | undefined) => {
    const time = next?.startTime ? Date.parse(next.startTime) : NaN
    changes.push({
      gameId, kind, publishedStartsAt: prior?.startsAt ?? null,
      currentScheduledAt: Number.isFinite(time) ? new Date(time).toISOString() : null,
      publishedPeriod: prior?.period ?? null,
      currentScheduledPeriod: Number.isFinite(time) ? scoringPeriodForGame(rules, new Date(time).toISOString()) : null,
      status: next?.status ?? null, replacedBy: next?.replacedBy ?? null,
    })
  }
  for (const [gameId, prior] of original) {
    const rows = byId.get(gameId) ?? []
    if (!rows.length) { add(gameId, 'missing', prior, undefined); continue }
    const [next] = rows
    if (rows.some(row => row.startTime !== next!.startTime || row.seasonType !== next!.seasonType || row.status !== next!.status || row.replacedBy !== next!.replacedBy)) { add(gameId, 'conflict', prior, next); continue }
    if (next!.replacedBy || /^replaced$/i.test(next!.status ?? '')) { add(gameId, 'replaced', prior, next); continue }
    if (/^cancell?ed$/i.test(next!.status ?? '')) { add(gameId, 'canceled', prior, next); continue }
    if (/^(postponed|delayed|suspended)$/i.test(next!.status ?? '')) { add(gameId, 'postponed', prior, next); continue }
    if (next!.seasonType !== 'regular' || !next!.startTime || !Number.isFinite(Date.parse(next!.startTime))) { add(gameId, 'unverified', prior, next); continue }
    if (Date.parse(next!.startTime) !== Date.parse(prior.startsAt)) add(gameId, 'rescheduled', prior, next)
  }
  for (const [gameId, rows] of byId) {
    if (original.has(gameId)) continue
    if (rows.some(row => row.seasonType !== 'regular' || row.replacedBy || /^(replaced|cancell?ed)$/i.test(row.status ?? ''))) continue
    const inScope = rows.some(row => {
      const time = row.startTime ? Date.parse(row.startTime) : NaN
      const day = row.day ? Date.parse(row.day + 'T12:00:00Z') : NaN
      if (Number.isFinite(time)) return time >= firstWindow && time < lastWindow
      return !Number.isFinite(day) || (day >= firstWindow - 86400000 && day < lastWindow + 86400000)
    })
    if (!inScope) continue
    if (rows.length !== 1) { add(gameId, 'conflict', undefined, rows[0]); continue }
    add(gameId, 'new_game', undefined, rows[0])
  }
  changes.sort((a, b) => a.gameId.localeCompare(b.gameId) || a.kind.localeCompare(b.kind))
  return { scheduleMatches: changes.length === 0, requiresReview: changes.length > 0, actualStartVerified: false, changes }
}
