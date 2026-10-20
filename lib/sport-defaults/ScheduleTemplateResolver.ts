/**
 * Resolves default schedule template by sport (fantasy schedule structure).
 * PROMPT 3/4: matchup type, regular/playoff weeks, lock mode, bracket support.
 */
import { prisma } from '@/lib/prisma'
import type { SportType } from './types'
import { toSportType } from './sport-type-utils'
import { DAILY_SPORT_SEASON_SHAPE, regularSeasonWeeksFor } from '@/lib/sportConfig/dailySportSeasonShape'

export interface ScheduleTemplateDto {
  templateId: string
  sportType: SportType
  name: string
  formatType: string
  matchupType: string
  regularSeasonWeeks: number
  playoffWeeks: number
  byeWeekWindow: { start: number; end: number } | null
  fantasyPlayoffDefault: { startWeek: number; endWeek: number } | null
  lineupLockMode: string | null
  scoringMode: string | null
  regularSeasonStyle: string | null
  playoffSupport: boolean
  bracketModeSupported: boolean
  marchMadnessMode: boolean
  bowlPlayoffMetadata: boolean
}

const IN_MEMORY_TEMPLATES: Record<SportType, Omit<ScheduleTemplateDto, 'templateId'>> = {
  NFL: {
    sportType: 'NFL',
    name: 'NFL_WEEKLY_H2H',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: 14,
    playoffWeeks: 3,
    byeWeekWindow: { start: 5, end: 14 },
    fantasyPlayoffDefault: { startWeek: 15, endWeek: 17 },
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'weekly',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  },
  MLB: {
    sportType: 'MLB',
    name: 'MLB_POINTS_DEFAULT',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: regularSeasonWeeksFor('MLB'),
    playoffWeeks: DAILY_SPORT_SEASON_SHAPE.MLB.playoffWeeks,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'long-form',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  },
  NHL: {
    sportType: 'NHL',
    name: 'NHL_WEEKLY_H2H',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: regularSeasonWeeksFor('NHL'),
    playoffWeeks: DAILY_SPORT_SEASON_SHAPE.NHL.playoffWeeks,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'weekly',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  },
  NBA: {
    sportType: 'NBA',
    name: 'NBA_POINTS_DEFAULT',
    formatType: 'DEFAULT',
    matchupType: 'head_to_head_points',
    regularSeasonWeeks: regularSeasonWeeksFor('NBA'),
    playoffWeeks: DAILY_SPORT_SEASON_SHAPE.NBA.playoffWeeks,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'weekly',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  },
  SOCCER: {
    sportType: 'SOCCER',
    name: 'SOCCER_WEEKLY_MATCHDAY',
    formatType: 'DEFAULT',
    matchupType: 'weekly_matchday',
    regularSeasonWeeks: 38,
    playoffWeeks: 0,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'weekly',
    playoffSupport: false,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  },
  NCAAB: {
    sportType: 'NCAAB',
    name: 'NCAAB_WEEKLY_H2H',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: 18,
    playoffWeeks: 4,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'season_tournament',
    playoffSupport: true,
    bracketModeSupported: true,
    marchMadnessMode: true,
    bowlPlayoffMetadata: false,
  },
  NCAAF: {
    sportType: 'NCAAF',
    name: 'NCAAF_WEEKLY_H2H',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: 15,
    playoffWeeks: 2,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'short_season',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: true,
  },
}

export async function getScheduleTemplate(
  sportType: SportType | string,
  formatType: string = 'DEFAULT'
): Promise<ScheduleTemplateDto> {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType) as SportType
  let row: Awaited<ReturnType<typeof prisma.scheduleTemplate.findUnique>>
  try {
    row = await prisma.scheduleTemplate.findUnique({
      where: { sportType_formatType: { sportType: sport, formatType } },
    })
  } catch (err) {
    // Production DBs may lag migrations (e.g. missing `sportType` column) — never fail league create.
    console.warn('[getScheduleTemplate] DB lookup failed; using in-memory template', { sport, formatType, err })
    row = null
  }
  if (row) {
    return {
      templateId: row.id,
      sportType: sport,
      name: row.name,
      formatType: row.formatType,
      matchupType: row.matchupType,
      regularSeasonWeeks: row.regularSeasonWeeks,
      playoffWeeks: row.playoffWeeks,
      byeWeekWindow: row.byeWeekWindow as { start: number; end: number } | null,
      fantasyPlayoffDefault: row.fantasyPlayoffDefault as { startWeek: number; endWeek: number } | null,
      lineupLockMode: row.lineupLockMode,
      scoringMode: row.scoringMode,
      regularSeasonStyle: row.regularSeasonStyle,
      playoffSupport: row.playoffSupport,
      bracketModeSupported: row.bracketModeSupported,
      marchMadnessMode: row.marchMadnessMode,
      bowlPlayoffMetadata: row.bowlPlayoffMetadata,
    }
  }
  const fallback = IN_MEMORY_TEMPLATES[sport] ?? IN_MEMORY_TEMPLATES.NFL
  return {
    templateId: `in-memory-${sport}-${formatType}`,
    ...fallback,
    formatType,
  }
}
