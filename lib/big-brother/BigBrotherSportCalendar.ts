/**
 * Big Brother League — sport-calendar dependent context.
 * Uses the sport's fantasy schedule template for regular season length and eviction end week.
 * Deterministic: no NFL-only assumptions; all supported sports use their own calendar.
 */

import type { LeagueSport } from '@prisma/client'
import { getScheduleTemplate } from '@/lib/sport-defaults/ScheduleTemplateResolver'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'
import { DEFAULT_EVICTION_END_WEEK_BY_SPORT } from './constants'

export interface BigBrotherSportCalendarContext {
  /** Sport for this league. */
  sport: LeagueSport | string
  /** Number of regular-season scoring weeks from the sport's schedule template. */
  regularSeasonWeeks: number
  /** Suggested last eviction week (social game ends before finale). */
  evictionEndWeek: number
  /** When true, show disclaimer that some games may not count depending on scoring-period cutoff (non-NFL). */
  showScoringWindowDisclaimer: boolean
  /** Short disclaimer text for non-NFL "every game counts" scoring model. Empty for NFL. */
  scoringWindowDisclaimer: string
  /** Human-readable note for commissioners: align deadlines to scoring week. */
  timelineNote: string
}

const NFL_SPORT = 'NFL'

/**
 * Returns sport-calendar context for Big Brother: regular season weeks, eviction end week,
 * and optional disclaimer for non-NFL leagues (scoring window / "every game counts").
 * Uses ScheduleTemplateResolver for regularSeasonWeeks and constants for eviction end week.
 */
export async function getBigBrotherSportCalendarContext(
  sport: LeagueSport | string
): Promise<BigBrotherSportCalendarContext> {
  const s = String(sport).toUpperCase().trim()
  const sportType = toSportType(s)
  const isNfl = s === NFL_SPORT

  const template = await getScheduleTemplate(sportType, 'DEFAULT')
  const regularSeasonWeeks = template.regularSeasonWeeks ?? 17
  const evictionEndWeek =
    DEFAULT_EVICTION_END_WEEK_BY_SPORT[s as LeagueSport] ??
    Math.min(regularSeasonWeeks + 2, 26)

  const showScoringWindowDisclaimer = !isNfl
  const scoringWindowDisclaimer = showScoringWindowDisclaimer
    ? 'For this sport, some games may not count toward the weekly total depending on the scoring-period cutoff and schedule alignment.'
    : ''

  const timelineNote =
    'Weekly deadlines (HOH, nominations, veto, voting) should align to your league\'s scoring week so fantasy points and evictions stay in sync.'

  return {
    sport: s as LeagueSport,
    regularSeasonWeeks,
    evictionEndWeek,
    showScoringWindowDisclaimer,
    scoringWindowDisclaimer,
    timelineNote,
  }
}

