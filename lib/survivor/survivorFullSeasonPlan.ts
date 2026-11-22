import { isSurvivorPlanSport, planRegularSeasonLastDay, planSeasonOpener, planWeekForInstant, planWeekWindow, type SurvivorPlanSport } from './survivorPlanCalendar'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { SURVIVOR_CAST_SIZE_MAX, SURVIVOR_CAST_SIZE_MIN } from '@/lib/league-creation-wizard/sport-team-limits'
import { SURVIVOR_MAX_ELIMINATIONS_PER_WEEK, eliminationsInWeek, noEliminationWeeksFor, seasonTooShortMessage, spreadEliminationWeeks } from './survivorEliminationSchedule'

export interface SurvivorFullSeasonPlan {
  version: 1
  sport: SurvivorPlanSport
  season: number
  castSize: number
  /** Finalists at Final Tribal Council (2 or 3); fixes how many eliminations the plan schedules. */
  finalistCount: 2 | 3
  exileReturnWeek?: number
  exileReturnSlots?: 1
  startWeek: number
  endWeek: number
  openingWeek: number
  finaleWeek: number
  /** One entry per elimination, ascending. A week listed twice holds two councils (see survivorEliminationSchedule). */
  eliminationWeeks: number[]
  noEliminationWeeks: number[]
  regularSeasonLastDay: string
}

export function buildSurvivorFullSeasonPlan(input: {
  sport: string; season: number; castSize: number; draftAt?: Date; now?: Date; endWeek?: number; exileEnabled?: boolean; exileReturnWeek?: number; finalistCount?: 2 | 3
}): SurvivorFullSeasonPlan {
  const sport = input.sport.toUpperCase()
  if (!isSurvivorPlanSport(sport)) throw new Error('Full-season planning currently supports NFL, NBA, NHL and MLB.')
  const opener = planSeasonOpener(sport, input.season)
  const lastDay = planRegularSeasonLastDay(sport, input.season)
  if (!opener || !lastDay) throw new Error(`The ${sport} ${input.season} season calendar has not been verified yet.`)
  if (!Number.isInteger(input.castSize) || input.castSize < SURVIVOR_CAST_SIZE_MIN || input.castSize > SURVIVOR_CAST_SIZE_MAX) throw new Error(`Survivor requires ${SURVIVOR_CAST_SIZE_MIN}–${SURVIVOR_CAST_SIZE_MAX} managers.`)
  const lastWeek = planWeekForInstant(sport, input.season, new Date(`${lastDay}T12:00:00Z`))!
  const endWeek = input.endWeek ?? lastWeek
  if (!Number.isInteger(endWeek) || endWeek < 1 || endWeek > lastWeek) throw new Error(`Choose an end week between 1 and ${lastWeek}.`)
  const instant = input.draftAt && input.draftAt > (input.now ?? new Date()) ? input.draftAt : input.now ?? new Date()
  const day = easternCalendarDay(instant)
  if (!day) throw new Error('The season start date could not be determined.')
  const current = planWeekForInstant(sport, input.season, instant)
  // Never backdate a draft into games already played. The first period is a readiness/practice week.
  const startWeek = day.getTime() < Date.parse(opener) ? 1 : (current ?? lastWeek) + 1
  // No week chosen: the usual week 10 when it fits, otherwise the middle of what remains. A league
  // created mid-season (an NFL league in November) used to be refused here for a default it never chose.
  const returnWeek = input.exileEnabled ? input.exileReturnWeek ?? defaultExileReturnWeek(startWeek, endWeek) : undefined
  if (returnWeek !== undefined && (!Number.isInteger(returnWeek) || returnWeek <= startWeek || returnWeek >= endWeek - 1)) throw new Error('Exile return week must follow the opening week and leave at least one elimination before the finale.')
  const finalistCount: 2 | 3 = input.finalistCount === 2 ? 2 : 3
  const requiredEliminations = input.castSize - finalistCount + (returnWeek !== undefined ? 1 : 0)
  // Space councils across the ENTIRE available season (opening and finale are reserved). One per
  // period when the season is long enough; otherwise some periods hold two, never more.
  const eliminationWeeks = spreadEliminationWeeks(startWeek, endWeek, requiredEliminations)
  if (!eliminationWeeks) throw new Error(seasonTooShortMessage(input.castSize, requiredEliminations, startWeek, endWeek))
  const noEliminationWeeks = noEliminationWeeksFor(startWeek, endWeek, eliminationWeeks)
  return { version: 1, sport, season: input.season, castSize: input.castSize, finalistCount, startWeek, endWeek,
    openingWeek: startWeek, finaleWeek: endWeek, ...(returnWeek !== undefined ? { exileReturnWeek: returnWeek, exileReturnSlots: 1 as const } : {}), eliminationWeeks, noEliminationWeeks, regularSeasonLastDay: lastDay }
}

/** Week 10 when it leaves room (after the opening week, at least one vote before the finale), else the midpoint. */
export function defaultExileReturnWeek(startWeek: number, endWeek: number): number {
  const fits = (week: number) => week > startWeek && week < endWeek - 1
  if (fits(10)) return 10
  const middle = Math.round((startWeek + endWeek) / 2)
  return fits(middle) ? middle : startWeek + 1
}

export function readSurvivorFullSeasonPlan(settings: unknown): SurvivorFullSeasonPlan | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>).survivor_full_season_plan
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as SurvivorFullSeasonPlan
  if (p.version !== 1 || !isSurvivorPlanSport(p.sport) || !Number.isInteger(p.season) || !Number.isInteger(p.castSize) || p.castSize < SURVIVOR_CAST_SIZE_MIN || p.castSize > SURVIVOR_CAST_SIZE_MAX || (p.finalistCount !== 2 && p.finalistCount !== 3) ||
    !Number.isInteger(p.startWeek) || !Number.isInteger(p.endWeek) || p.startWeek < 1 || p.endWeek <= p.startWeek || p.endWeek > 52 || p.openingWeek !== p.startWeek || p.finaleWeek !== p.endWeek ||
    !Array.isArray(p.eliminationWeeks) || p.eliminationWeeks.length !== p.castSize - p.finalistCount + (p.exileReturnSlots ?? 0) || p.eliminationWeeks.some(week => eliminationsInWeek(p.eliminationWeeks, week) > SURVIVOR_MAX_ELIMINATIONS_PER_WEEK) ||
    p.eliminationWeeks.some(week => !Number.isInteger(week) || week <= p.startWeek || week >= p.endWeek) ||
    !planWeekWindow(p.sport, p.season, p.endWeek)) return null
  if ((p.exileReturnSlots !== undefined || p.exileReturnWeek !== undefined) && (p.exileReturnSlots !== 1 || !Number.isInteger(p.exileReturnWeek) || p.exileReturnWeek! <= p.startWeek || p.exileReturnWeek! >= p.endWeek - 1)) return null
  const lastDay = planRegularSeasonLastDay(p.sport, p.season)
  const lastWeek = lastDay ? planWeekForInstant(p.sport, p.season, new Date(lastDay + 'T12:00:00Z')) : null
  const expectedRest = noEliminationWeeksFor(p.startWeek, p.endWeek, p.eliminationWeeks)
  if (!lastWeek || p.endWeek > lastWeek || p.regularSeasonLastDay !== lastDay || !Array.isArray(p.noEliminationWeeks) ||
    JSON.stringify(p.noEliminationWeeks) !== JSON.stringify(expectedRest)) return null
  return p
}
