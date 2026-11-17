/**
 * Resolves projection engine inputs by sport: scoring rules and optional schedule/stat context.
 * Used by projection and simulation pipelines so they use league-specific scoring and period semantics.
 */
import type { LeagueSport } from '@prisma/client'
import {
  getLeagueSettingsForScoring,
  getScoringTemplateForSport,
  resolveFormatTypeFromLeagueSettings,
  resolveScoringRulesForLeague,
} from './MultiSportScoringResolver'
import { resolveScheduleContextForLeague } from './MultiSportScheduleResolver'
import type { ScoringRuleDto } from './ScoringTemplateResolver'

interface ProjectionSeedInput {
  leagueId?: string
  leagueSport: LeagueSport
  season: number
  weekOrRound: number
  formatType?: string
}

interface ProjectionSeed {
  sportType: string
  season: number
  weekOrRound: number
  totalWeeksOrRounds: number
  label: 'week' | 'round'
  scoringRules: ScoringRuleDto[]
  templateId: string
}

/**
 * Resolve projection seed for a league/period: schedule context + scoring rules.
 * Use scoring rules when generating or valuing projections; use schedule context for period bounds.
 */
export async function resolveProjectionSeed(
  input: ProjectionSeedInput
): Promise<ProjectionSeed> {
  const leagueSettings = input.leagueId
    ? await getLeagueSettingsForScoring(input.leagueId)
    : null
  const resolvedFormatType =
    input.formatType ??
    resolveFormatTypeFromLeagueSettings(input.leagueSport, leagueSettings)

  const template = await getScoringTemplateForSport(
    input.leagueSport,
    resolvedFormatType
  )
  const scheduleCtx = await resolveScheduleContextForLeague(
    input.leagueSport,
    input.season,
    input.weekOrRound,
    resolvedFormatType
  )
  const scoringRules = input.leagueId
    ? await resolveScoringRulesForLeague(
        input.leagueId,
        input.leagueSport,
        input.formatType,
        leagueSettings
      )
    : template.rules
  return {
    sportType: scheduleCtx.sportType,
    season: input.season,
    weekOrRound: input.weekOrRound,
    totalWeeksOrRounds: scheduleCtx.totalWeeksOrRounds,
    label: scheduleCtx.label,
    scoringRules,
    templateId: template.templateId,
  }
}
