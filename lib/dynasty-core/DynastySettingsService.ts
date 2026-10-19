/**
 * Dynasty settings service: effective settings, presets, upsert config, draft order audit.
 */
import { prisma } from '@/lib/prisma'
import { getRosterTemplate } from '@/lib/multi-sport/RosterTemplateService'
import { getScoringTemplate } from '@/lib/multi-sport/ScoringTemplateResolver'
import { getDynastyRosterPresetList } from './DynastyRosterPresets'
import { getDynastyScoringPresetList } from './DynastyScoringPresets'
import { getDynastyPlayoffPresetList } from './DynastyPlayoffPresets'
import {
  DYNASTY_DEFAULT_REGULAR_SEASON_WEEKS,
  DYNASTY_DEFAULT_ROOKIE_DRAFT_ROUNDS,
  DYNASTY_DEFAULT_ROOKIE_DRAFT_TYPE,
  ROOKIE_PICK_ORDER_METHODS,
  isDynastyFootballSport,
} from './constants'
import type {
  DynastyLeagueConfigDto,
  DynastySettingsEffectiveDto,
  DynastyDraftOrderAuditEntryDto,
} from './types'
import type { SportType } from '@/lib/multi-sport/sport-types'

/**
 * Get effective dynasty settings for a league (roster, scoring, playoff, rookie draft).
 * Returns merged League.settings + DynastyLeagueConfig with resolved roster/scoring summary.
 */
export async function getEffectiveDynastySettings(
  leagueId: string
): Promise<DynastySettingsEffectiveDto | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      leagueSize: true,
      sport: true,
      settings: true,
      dynastyConfig: true,
    },
  })
  if (!league) return null

  const settings = (league.settings as Record<string, unknown>) ?? {}
  // The superflex/PPR fallbacks are football formats; MLB/NBA/NHL fall back to their own dynasty
  // roster template and standard scoring instead of being summarised as an NFL league.
  const football = isDynastyFootballSport(league.sport as string | null)
  const rosterFormatType =
    (settings.roster_format_type as string) ??
    (settings.roster_format as string) ??
    (football ? 'dynasty_superflex' : 'dynasty')
  const scoringFormatType =
    (settings.scoring_format_type as string) ??
    (settings.scoring_format as string) ??
    (football ? 'PPR' : 'standard')
  const playoffTeamCount = (settings.playoff_team_count as number) ?? 6
  const playoffStructure = (settings.playoff_structure as Record<string, unknown>) ?? {}
  const regularSeasonWeeks =
    (settings.regular_season_weeks as number) ??
    (league.dynastyConfig?.regularSeasonWeeks ?? DYNASTY_DEFAULT_REGULAR_SEASON_WEEKS)

  const sportType = (league.sport as SportType) ?? 'NFL'
  let rosterSummary: { slotName: string; count: number }[] = []
  let scoringPresetName = scoringFormatType

  try {
    const rosterTemplate = await getRosterTemplate(sportType, rosterFormatType)
    rosterSummary = rosterTemplate.slots
      .filter((s) => s.starterCount > 0 || s.benchCount > 0 || s.reserveCount > 0 || s.taxiCount > 0)
      .map((s) => ({
        slotName: s.slotName,
        count:
          s.starterCount +
          s.benchCount +
          s.reserveCount +
          (s.taxiCount > 0 ? s.taxiCount : 0),
      }))
      .filter((s) => s.count > 0)
  } catch {
    rosterSummary = []
  }

  try {
    const scoringTemplate = await getScoringTemplate(sportType, scoringFormatType)
    scoringPresetName = scoringTemplate.name
  } catch {
    // keep scoringFormatType as name
  }

  const config = league.dynastyConfig

  return {
    leagueSize: league.leagueSize ?? null,
    rosterFormatType,
    scoringFormatType,
    playoffTeamCount,
    playoffStructure,
    regularSeasonWeeks,
    rookiePickOrderMethod: config?.rookiePickOrderMethod ?? 'max_pf',
    useMaxPfForNonPlayoff: config?.useMaxPfForNonPlayoff ?? true,
    rookieDraftRounds: config?.rookieDraftRounds ?? DYNASTY_DEFAULT_ROOKIE_DRAFT_ROUNDS,
    rookieDraftType: config?.rookieDraftType ?? DYNASTY_DEFAULT_ROOKIE_DRAFT_TYPE,
    divisionsEnabled: config?.divisionsEnabled ?? false,
    tradeDeadlineWeek: config?.tradeDeadlineWeek ?? null,
    waiverTypeRecommended: config?.waiverTypeRecommended ?? 'faab',
    futurePicksYearsOut: config?.futurePicksYearsOut ?? 3,
    rosterSummary,
    scoringPresetName,
    taxiSlots: config?.taxiSlots ?? 4,
    taxiEligibilityYears: config?.taxiEligibilityYears ?? 1,
    taxiLockBehavior: config?.taxiLockBehavior ?? 'once_promoted_no_return',
    taxiInSeasonMoves: config?.taxiInSeasonMoves ?? true,
    taxiPostseasonMoves: config?.taxiPostseasonMoves ?? false,
    taxiScoringOn: config?.taxiScoringOn ?? false,
    taxiDeadlineWeek: config?.taxiDeadlineWeek ?? null,
    taxiPromotionDeadlineWeek: config?.taxiPromotionDeadlineWeek ?? null,
  }
}

/**
 * Get roster presets for dynasty (1QB, Superflex, 2QB, TEP, IDP).
 */
export function getDynastyRosterPresets(): ReturnType<typeof getDynastyRosterPresetList> {
  return getDynastyRosterPresetList()
}

/**
 * Get scoring presets for dynasty.
 */
export function getDynastyScoringPresets(): ReturnType<typeof getDynastyScoringPresetList> {
  return getDynastyScoringPresetList()
}

/**
 * Get playoff presets (4/6/8/10 team) for a sport.
 */
export function getDynastyPlayoffPresets(sport: string = 'NFL'): ReturnType<typeof getDynastyPlayoffPresetList> {
  return getDynastyPlayoffPresetList(sport)
}

/**
 * Upsert DynastyLeagueConfig for a league.
 */
export async function upsertDynastyConfig(
  leagueId: string,
  payload: Partial<{
    regularSeasonWeeks: number
    rookiePickOrderMethod: string
    useMaxPfForNonPlayoff: boolean
    rookieDraftRounds: number
    rookieDraftType: string
    divisionsEnabled: boolean
    tradeDeadlineWeek: number | null
    waiverTypeRecommended: string
    futurePicksYearsOut: number
    taxiSlots: number
    taxiEligibilityYears: number
    taxiLockBehavior: string
    taxiInSeasonMoves: boolean
    taxiPostseasonMoves: boolean
    taxiScoringOn: boolean
    taxiDeadlineWeek: number | null
    taxiPromotionDeadlineWeek: number | null
  }>
): Promise<DynastyLeagueConfigDto> {
  const existing = await prisma.dynastyLeagueConfig.findUnique({
    where: { leagueId },
  })

  const data = {
    regularSeasonWeeks: payload.regularSeasonWeeks ?? existing?.regularSeasonWeeks ?? DYNASTY_DEFAULT_REGULAR_SEASON_WEEKS,
    rookiePickOrderMethod: payload.rookiePickOrderMethod ?? existing?.rookiePickOrderMethod ?? 'max_pf',
    useMaxPfForNonPlayoff: payload.useMaxPfForNonPlayoff ?? existing?.useMaxPfForNonPlayoff ?? true,
    rookieDraftRounds: payload.rookieDraftRounds ?? existing?.rookieDraftRounds ?? DYNASTY_DEFAULT_ROOKIE_DRAFT_ROUNDS,
    rookieDraftType: payload.rookieDraftType ?? existing?.rookieDraftType ?? DYNASTY_DEFAULT_ROOKIE_DRAFT_TYPE,
    divisionsEnabled: payload.divisionsEnabled ?? existing?.divisionsEnabled ?? false,
    tradeDeadlineWeek: payload.tradeDeadlineWeek ?? existing?.tradeDeadlineWeek ?? undefined,
    waiverTypeRecommended: payload.waiverTypeRecommended ?? existing?.waiverTypeRecommended ?? 'faab',
    futurePicksYearsOut: payload.futurePicksYearsOut ?? existing?.futurePicksYearsOut ?? 3,
    taxiSlots: payload.taxiSlots ?? existing?.taxiSlots ?? 4,
    taxiEligibilityYears: payload.taxiEligibilityYears ?? existing?.taxiEligibilityYears ?? 1,
    taxiLockBehavior: payload.taxiLockBehavior ?? existing?.taxiLockBehavior ?? 'once_promoted_no_return',
    taxiInSeasonMoves: payload.taxiInSeasonMoves ?? existing?.taxiInSeasonMoves ?? true,
    taxiPostseasonMoves: payload.taxiPostseasonMoves ?? existing?.taxiPostseasonMoves ?? false,
    taxiScoringOn: payload.taxiScoringOn ?? existing?.taxiScoringOn ?? false,
    taxiDeadlineWeek: payload.taxiDeadlineWeek !== undefined ? payload.taxiDeadlineWeek : existing?.taxiDeadlineWeek ?? undefined,
    taxiPromotionDeadlineWeek: payload.taxiPromotionDeadlineWeek !== undefined ? payload.taxiPromotionDeadlineWeek : existing?.taxiPromotionDeadlineWeek ?? undefined,
  }

  const config = await prisma.dynastyLeagueConfig.upsert({
    where: { leagueId },
    create: { leagueId, ...data },
    update: data,
  })

  return {
    leagueId: config.leagueId,
    regularSeasonWeeks: config.regularSeasonWeeks,
    rookiePickOrderMethod: config.rookiePickOrderMethod,
    useMaxPfForNonPlayoff: config.useMaxPfForNonPlayoff,
    rookieDraftRounds: config.rookieDraftRounds,
    rookieDraftType: config.rookieDraftType,
    divisionsEnabled: config.divisionsEnabled,
    tradeDeadlineWeek: config.tradeDeadlineWeek,
    waiverTypeRecommended: config.waiverTypeRecommended,
    futurePicksYearsOut: config.futurePicksYearsOut,
    taxiSlots: config.taxiSlots,
    taxiEligibilityYears: config.taxiEligibilityYears,
    taxiLockBehavior: config.taxiLockBehavior,
    taxiInSeasonMoves: config.taxiInSeasonMoves,
    taxiPostseasonMoves: config.taxiPostseasonMoves,
    taxiScoringOn: config.taxiScoringOn,
    taxiDeadlineWeek: config.taxiDeadlineWeek,
    taxiPromotionDeadlineWeek: config.taxiPromotionDeadlineWeek,
  }
}

/**
 * Log a commissioner draft order override (audit log).
 */
export async function logDraftOrderOverride(
  leagueId: string,
  configId: string,
  season: number,
  overridePayload: Record<string, unknown>,
  userId: string,
  reason?: string | null
): Promise<void> {
  await prisma.dynastyDraftOrderAuditLog.create({
    data: {
      leagueId,
      configId,
      season,
      overridePayload: overridePayload as object,
      userId,
      reason: reason ?? null,
    },
  })
}

/**
 * Get draft order audit log entries for a league (for commissioner UI).
 */
export async function getDraftOrderAuditLog(
  leagueId: string,
  limit: number = 50
): Promise<DynastyDraftOrderAuditEntryDto[]> {
  const logs = await prisma.dynastyDraftOrderAuditLog.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return logs.map((l) => ({
    id: l.id,
    season: l.season,
    userId: l.userId,
    reason: l.reason ?? null,
    createdAt: l.createdAt.toISOString(),
  }))
}

export { ROOKIE_PICK_ORDER_METHODS }
