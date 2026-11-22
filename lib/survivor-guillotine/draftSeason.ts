import { buildSGSchedule } from './config'
import type { SGConfig } from './types'

/** The combined season owns its periods; provider week numbers and H2H playoffs do not. */
export function sgDraftScoringCalendar(value: unknown) {
  const config = value as SGConfig
  const schedule = buildSGSchedule(config)
  if (schedule.errors.length) throw new Error(schedule.errors.join(' '))
  return { firstWeek: 1, totalWeeks: config.championshipPeriod, playoffStartWeek: config.championshipPeriod + 1 }
}
