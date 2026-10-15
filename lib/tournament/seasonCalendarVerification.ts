import 'server-only'
import { createHash } from 'node:crypto'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { parseRiScheduleSeason } from '@/lib/sports-data/riSeasonSchedule'
import { assessSeasonCalendar, type CalendarCoverage, type CalendarGame } from './seasonCalendarCoverage'
import type { SeasonBlueprint } from './seasonBlueprint'

export function seasonContractHash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, canonical(val)])) : v
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export type VerifiedSeasonCalendar = CalendarCoverage & { provider: 'rolling_insights'; season: number; checkedAt: string; digest: string }
export async function fetchSeasonCalendarGames(config: SeasonBlueprint): Promise<{ games: CalendarGame[]; season: number }> {
  const year = config.rules?.calendar.regularSeasonStartsAt ? new Date(config.rules.calendar.regularSeasonStartsAt).getUTCFullYear() : NaN
  if (!Number.isInteger(year)) throw new Error('Set the regular-season bounds before checking the provider schedule.')
  const response = await riFetchRows('schedule_season', { sport: config.sport, season: year, timeoutMs: 15000 })
  if (response.error || response.notModified || response.unsupported) throw new Error('A fresh season schedule is unavailable. Try again after the provider feed is available.')
  const games = parseRiScheduleSeason(response.rows)
  // The parser skips malformed vendor rows. Never certify a silently truncated schedule.
  if (games.length !== response.rows.length) throw new Error('The provider returned malformed schedule rows. Calendar verification is blocked.')
  return { games, season: year }
}
export async function verifySeasonCalendar(config: SeasonBlueprint): Promise<VerifiedSeasonCalendar> {
  const { games, season: year } = await fetchSeasonCalendarGames(config)
  const report = assessSeasonCalendar(config, games)
  const evidence = { ...report, provider: 'rolling_insights' as const, season: year }
  return { ...evidence, checkedAt: new Date().toISOString(), digest: seasonContractHash({ config, evidence }) }
}
