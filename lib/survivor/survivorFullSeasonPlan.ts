import { dailySportWeekForInstant, resolveDailySportSeasonStart, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { SURVIVOR_CAST_SIZE_MAX, SURVIVOR_CAST_SIZE_MIN } from '@/lib/league-creation-wizard/sport-team-limits'

/** Published regular-season last days. Year is the year the season BEGINS. */
const LAST_DAY: Record<string, Record<number, string>> = {
  // https://pr.nba.com/2026-27-nba-regular-season-schedule/
  NBA: { 2026: '2027-04-11' },
  // https://www.nhl.com/news/nhl-announces-2026-27-regular-season-schedule
  NHL: { 2026: '2027-04-10' },
}

export interface SurvivorFullSeasonPlan {
  version: 1
  sport: 'NBA' | 'NHL'
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
  eliminationWeeks: number[]
  noEliminationWeeks: number[]
  regularSeasonLastDay: string
}

export function buildSurvivorFullSeasonPlan(input: {
  sport: string; season: number; castSize: number; draftAt?: Date; now?: Date; endWeek?: number; exileEnabled?: boolean; exileReturnWeek?: number; finalistCount?: 2 | 3
}): SurvivorFullSeasonPlan {
  const sport = input.sport.toUpperCase()
  if (sport !== 'NBA' && sport !== 'NHL') throw new Error('Full-season planning currently supports NBA and NHL.')
  const opener = resolveDailySportSeasonStart(sport, input.season)
  const lastDay = LAST_DAY[sport]?.[input.season]
  if (!opener || !lastDay) throw new Error(`The ${sport} ${input.season} season calendar has not been verified yet.`)
  if (!Number.isInteger(input.castSize) || input.castSize < SURVIVOR_CAST_SIZE_MIN || input.castSize > SURVIVOR_CAST_SIZE_MAX) throw new Error(`Survivor requires ${SURVIVOR_CAST_SIZE_MIN}–${SURVIVOR_CAST_SIZE_MAX} managers.`)
  const lastWeek = dailySportWeekForInstant(sport, input.season, new Date(`${lastDay}T12:00:00Z`))!
  const endWeek = input.endWeek ?? lastWeek
  if (!Number.isInteger(endWeek) || endWeek < 1 || endWeek > lastWeek) throw new Error(`Choose an end week between 1 and ${lastWeek}.`)
  const instant = input.draftAt && input.draftAt > (input.now ?? new Date()) ? input.draftAt : input.now ?? new Date()
  const day = easternCalendarDay(instant)
  if (!day) throw new Error('The season start date could not be determined.')
  const current = dailySportWeekForInstant(sport, input.season, instant)
  // Never backdate a draft into games already played. The first period is a readiness/practice week.
  const startWeek = day.getTime() < Date.parse(opener) ? 1 : (current ?? lastWeek) + 1
  const returnWeek = input.exileEnabled ? input.exileReturnWeek ?? 10 : undefined
  if (returnWeek !== undefined && (!Number.isInteger(returnWeek) || returnWeek <= startWeek || returnWeek >= endWeek - 1)) throw new Error('Exile return week must follow the opening week and leave at least one elimination before the finale.')
  const finalistCount: 2 | 3 = input.finalistCount === 2 ? 2 : 3
  const requiredEliminations = input.castSize - finalistCount + (returnWeek !== undefined ? 1 : 0)
  const available = endWeek - startWeek - 1 // opening + finale are reserved
  if (available < requiredEliminations) throw new Error(`Not enough season remains for ${input.castSize} managers: ${requiredEliminations + 2} scoring periods are required, but only ${Math.max(0, endWeek - startWeek + 1)} remain. Choose a smaller cast, an earlier draft, or next season.`)
  // Space councils across the ENTIRE available season. At most one elimination per period.
  const eliminationWeeks = Array.from({ length: requiredEliminations }, (_, index) => startWeek + Math.ceil((index + 1) * available / requiredEliminations))
  const noEliminationWeeks = Array.from({ length: endWeek - startWeek }, (_, i) => startWeek + i).filter(week => !eliminationWeeks.includes(week))
  return { version: 1, sport, season: input.season, castSize: input.castSize, finalistCount, startWeek, endWeek,
    openingWeek: startWeek, finaleWeek: endWeek, ...(returnWeek !== undefined ? { exileReturnWeek: returnWeek, exileReturnSlots: 1 as const } : {}), eliminationWeeks, noEliminationWeeks, regularSeasonLastDay: lastDay }
}

export function readSurvivorFullSeasonPlan(settings: unknown): SurvivorFullSeasonPlan | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>).survivor_full_season_plan
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as SurvivorFullSeasonPlan
  if (p.version !== 1 || !['NBA', 'NHL'].includes(p.sport) || !Number.isInteger(p.season) || !Number.isInteger(p.castSize) || p.castSize < SURVIVOR_CAST_SIZE_MIN || p.castSize > SURVIVOR_CAST_SIZE_MAX || (p.finalistCount !== 2 && p.finalistCount !== 3) ||
    !Number.isInteger(p.startWeek) || !Number.isInteger(p.endWeek) || p.startWeek < 1 || p.endWeek <= p.startWeek || p.endWeek > 52 || p.openingWeek !== p.startWeek || p.finaleWeek !== p.endWeek ||
    !Array.isArray(p.eliminationWeeks) || p.eliminationWeeks.length !== p.castSize - p.finalistCount + (p.exileReturnSlots ?? 0) || new Set(p.eliminationWeeks).size !== p.eliminationWeeks.length ||
    p.eliminationWeeks.some(week => !Number.isInteger(week) || week <= p.startWeek || week >= p.endWeek) ||
    !resolveDailySportWeekWindow(p.sport, p.season, p.endWeek)) return null
  if ((p.exileReturnSlots !== undefined || p.exileReturnWeek !== undefined) && (p.exileReturnSlots !== 1 || !Number.isInteger(p.exileReturnWeek) || p.exileReturnWeek! <= p.startWeek || p.exileReturnWeek! >= p.endWeek - 1)) return null
  const lastDay = LAST_DAY[p.sport]?.[p.season]
  const lastWeek = lastDay ? dailySportWeekForInstant(p.sport, p.season, new Date(lastDay + 'T12:00:00Z')) : null
  const expectedRest = Array.from({ length: p.endWeek - p.startWeek }, (_, i) => p.startWeek + i).filter(week => !p.eliminationWeeks.includes(week))
  if (!lastWeek || p.endWeek > lastWeek || p.regularSeasonLastDay !== lastDay || !Array.isArray(p.noEliminationWeeks) ||
    JSON.stringify(p.noEliminationWeeks) !== JSON.stringify(expectedRest)) return null
  return p
}
