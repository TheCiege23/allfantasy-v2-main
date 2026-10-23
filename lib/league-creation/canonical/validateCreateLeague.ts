import { readSurvivorLateSeasonSettings } from '@/lib/survivor/lateSeasonSettings'
import { validateTribeSlots } from '@/lib/survivor/survivorTribeIdentity'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { buildSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { isSurvivorPlanSport } from '@/lib/survivor/survivorPlanCalendar'
import { resolveLeagueCreationSeason } from '@/lib/season-week/leagueCreationSeason'
import { tournamentRoundEnds } from '@/lib/bestball/tournamentCalendar'
/**
 * Create League (canonical) — request validation before preset engine + transaction.
 */

import { z } from 'zod'
import { resolveDynastyCreationRoster } from './dynastyCreationRoster'
import { isValidIanaTimeZone, toUtc } from '@/lib/timezone'
import { TE_PREMIUM_POINT_OPTIONS, isValidTePremiumPoints } from '@/lib/nfl-scoring/nflScoringSeedForCreate'
import type { LeagueSport } from '@prisma/client'
import { getSurvivorTribeOptions, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import {
  isDraftTypeAllowedForFormat,
  isLeagueFormatAllowedForSport,
} from '@/lib/league/format-engine'
import {
  normalizeDraftTypeForEngineValidation,
  resolveEffectiveDraftTypeForConcept,
} from '@/lib/draft-types/draftTypeRegistry'
import { isAllowedIdpDraftType, normalizeToSupportedSport, supportsIdpLeagueSport } from '@/lib/sport-scope'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { checkRetiredConcept } from '@/lib/league-creation/retiredConcepts'
import {
  isSurvivorCreationSportAvailable,
  SURVIVOR_CREATION_UNAVAILABLE_MESSAGE,
  SURVIVOR_PAID_CREATION_ENABLED,
  SURVIVOR_PAID_CREATION_UNAVAILABLE_MESSAGE,
} from '@/lib/survivor/survivorCreationAvailability'
import type { SupportedSport } from '@/lib/create-league-v2/state'
import type { ValidationIssue } from '@/lib/league-creation/canonical/types'
import {
  isBestBallSupportedSport,
  normalizeBestBallSettings,
} from '@/lib/bestball/rules'
import { isSupportedDevyCreateDraftType } from '@/lib/league-concepts/devyDefaults'
import { receptionPointsForScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'
import {
  PROSPECT_STASH_UNAVAILABLE_CODE,
  PROSPECT_STASH_UNAVAILABLE_MESSAGE,
  sportSupportsProspectStash,
} from '@/lib/league-creation/prospectStashPolicy'

/** Maps execution modes (offline/auto/team) to a core draft id for format-engine checks. */
export function normalizeDraftTypeForEngine(draftType: string): string {
  return normalizeDraftTypeForEngineValidation(draftType)
}

export const FORBIDDEN_CREATE_LEAGUE_USER_KEYS = [
  'userId',
  'user_id',
  'commissionerUserId',
  'commissionerId',
  'ownerUserId',
  'appUserId',
] as const

export function stripForbiddenCreateLeagueFields(input: unknown): {
  body: unknown
  strippedKeys: string[]
} {
  if (!input || typeof input !== 'object') {
    return { body: input, strippedKeys: [] }
  }
  const o = { ...(input as Record<string, unknown>) }
  const strippedKeys: string[] = []
  for (const k of FORBIDDEN_CREATE_LEAGUE_USER_KEYS) {
    if (k in o && o[k] !== undefined) {
      strippedKeys.push(k)
      delete o[k]
    }
  }
  return { body: o, strippedKeys }
}

const dynastyCreationChoicesSchema = z.object({
  startupRosterDepth: z.number().int().min(1).max(80).optional(),
  benchCount: z.number().int().min(0).max(50).optional(),
  irCount: z.number().int().min(0).max(10).optional(),
  taxiSlots: z.number().int().min(0).max(20).optional(),
  regularSeasonWeeks: z.number().int().min(6).max(40).optional(),
  playoffTeamCount: z.number().int().min(2).max(32).optional(),
  waiverTypeRecommended: z.enum(['faab', 'rolling', 'reverse_standings']).optional(),
  faabBudget: z.number().int().min(0).max(10000).optional(),
}).passthrough()

const SPORTS = z.enum(['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'])

export const createLeagueBodySchema = z.object({
  concept: z.string().min(1).max(64),
  sport: SPORTS,
  scoringPreset: z.string().min(1).max(96).trim(),
  teamCount: z.number().int().min(2).max(256),
  draftType: z.string().min(1).max(32),
  leagueName: z.string().min(1).max(100).trim(),
  conceptSetup: z.record(z.unknown()).optional().nullable(),
  soccerPipeline: z.enum(['mls', 'euro']).optional().nullable(),
  timezone: z.string().trim().min(1).max(64).refine(isValidIanaTimeZone, 'Choose a valid IANA timezone').optional(),
  language: z.enum(['en', 'es']).optional(),
  tradeReviewMode: z.enum(['commissioner', 'league_vote', 'instant', 'none']).optional(),
})

export type ValidatedCreateLeagueBody = z.infer<typeof createLeagueBodySchema> & {
  sport: LeagueSport
}

export type ValidateCreateLeagueResult =
  | { ok: true; data: ValidatedCreateLeagueBody }
  | { ok: false; error: string; status: number; errors: ValidationIssue[] }

function issuesFromZod(err: z.ZodError): ValidationIssue[] {
  return err.issues.map((i) => ({
    path: i.path.join('.') || 'request',
    message: i.message,
    code: i.code,
  }))
}

/**
 * Structural + business validation (format-engine allowlists, team counts).
 */
export function validateCreatePayload(input: unknown): ValidateCreateLeagueResult {
  const stripped = stripForbiddenCreateLeagueFields(input)
  const parsed = createLeagueBodySchema.safeParse(stripped.body)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid request',
      status: 400,
      errors: issuesFromZod(parsed.error),
    }
  }

  const data = parsed.data as ValidatedCreateLeagueBody
  const sport = normalizeToSupportedSport(data.sport)
  const schedule = data.conceptSetup ?? {}
  const date = schedule.draftDate
  const time = schedule.draftTime
  const zone = schedule.draftTimezone ?? data.timezone ?? 'America/New_York'
  const scheduleErrors: ValidationIssue[] = []
  if (schedule.draftTimezone != null && (typeof zone !== 'string' || !isValidIanaTimeZone(zone))) {
    scheduleErrors.push({ path: 'conceptSetup.draftTimezone', message: 'Choose a valid draft timezone' })
  }
  if (date || time) {
    const validDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
    const validTime = typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    if (!validDate) scheduleErrors.push({ path: 'conceptSetup.draftDate', message: 'Choose a valid draft date' })
    if (!validTime) scheduleErrors.push({ path: 'conceptSetup.draftTime', message: 'Choose a valid draft time' })
    if (validDate && validTime && typeof zone === 'string' && isValidIanaTimeZone(zone) &&
        Number.isNaN(toUtc(date as string, time as string, zone).getTime())) {
      scheduleErrors.push({ path: 'conceptSetup.draftDate', message: 'Choose a valid draft schedule' })
    }
  }
  if (scheduleErrors.length) {
    return { ok: false, error: scheduleErrors[0].message, status: 400, errors: scheduleErrors }
  }

  if (sport === 'SOCCER' && !data.soccerPipeline) {
    return {
      ok: false,
      error: 'Soccer requires soccerPipeline (mls or euro)',
      status: 400,
      errors: [{ path: 'soccerPipeline', message: 'Choose MLS or European pipeline for Soccer' }],
    }
  }
  if (sport !== 'SOCCER' && data.soccerPipeline) {
    return {
      ok: false,
      error: 'soccerPipeline is only valid for Soccer',
      status: 400,
      errors: [{ path: 'soccerPipeline', message: 'Remove soccerPipeline unless sport is SOCCER' }],
    }
  }

  const normalized = normalizeConceptToFormat(data.concept)
  if (!normalized) {
    return {
      ok: false,
      error: 'Unknown league concept',
      status: 400,
      errors: [{ path: 'concept', message: 'Invalid or unsupported concept' }],
    }
  }

  // Retired concepts may no longer be created. Checked against the NORMALISED
  // format id, so casing ("TOURNAMENT"), surrounding whitespace and alias
  // spellings are all covered — `normalizeConceptToFormat` folds them first.
  // Reads and imports of existing leagues are deliberately unaffected.
  const retired = checkRetiredConcept(normalized.formatId)
  if (retired) {
    return {
      ok: false,
      error: retired.message,
      status: 400,
      errors: [{ path: 'concept', message: retired.message, code: retired.code }],
    }
  }

  const formatId = normalized.formatId
  if (formatId === 'survivor' && !isSurvivorCreationSportAvailable(sport)) {
    return { ok: false, error: SURVIVOR_CREATION_UNAVAILABLE_MESSAGE, status: 400,
      errors: [{ path: 'sport', message: SURVIVOR_CREATION_UNAVAILABLE_MESSAGE }] }
  }
  if (formatId === 'survivor' && !SURVIVOR_PAID_CREATION_ENABLED &&
      (data.conceptSetup?.survivor_entry_fee_mode === 'paid' || data.conceptSetup?.survivorEntryFeeMode === 'paid')) {
    return { ok: false, error: SURVIVOR_PAID_CREATION_UNAVAILABLE_MESSAGE, status: 400,
      errors: [{ path: 'conceptSetup.survivor_entry_fee_mode', message: SURVIVOR_PAID_CREATION_UNAVAILABLE_MESSAGE }] }
  }
  // NHL / MLB have no prospect pool: refuse a taxi squad or devy rounds on any concept that carries them.
  if (!sportSupportsProspectStash(sport)) {
    const setup = data.conceptSetup ?? {}
    const taxi = Number(setup.taxiSlots ?? setup.taxiSize ?? 0)
    const path = Number.isFinite(taxi) && taxi > 0 ? 'conceptSetup.taxiSlots'
      : setup.devyRoundsEnabled === true ? 'conceptSetup.devyRoundsEnabled' : null
    if (path) {
      return { ok: false, status: 400, error: PROSPECT_STASH_UNAVAILABLE_MESSAGE,
        errors: [{ path, message: PROSPECT_STASH_UNAVAILABLE_MESSAGE, code: PROSPECT_STASH_UNAVAILABLE_CODE }] }
    }
  }
  if (formatId === 'dynasty') {
    const choices = dynastyCreationChoicesSchema.safeParse(data.conceptSetup ?? {})
    if (!choices.success) {
      return { ok: false, error: choices.error.issues[0]?.message ?? 'Invalid dynasty settings', status: 400,
        errors: issuesFromZod(choices.error).map((issue) => ({ ...issue, path: 'conceptSetup.' + issue.path })) }
    }
    if (typeof choices.data.startupRosterDepth === 'number' &&
        choices.data.startupRosterDepth > resolveDynastyCreationRoster(data.sport, choices.data).totalRosterSlots) {
      return { ok: false, error: 'Startup draft rounds exceed roster capacity', status: 400,
        errors: [{ path: 'conceptSetup.startupRosterDepth', message: 'Add roster slots or reduce startup draft rounds so the draft can finish' }] }
    }
    if (typeof choices.data.playoffTeamCount === 'number' && choices.data.playoffTeamCount > data.teamCount) {
      return { ok: false, error: 'Playoff teams cannot exceed team count', status: 400,
        errors: [{ path: 'conceptSetup.playoffTeamCount', message: 'Playoff teams cannot exceed team count' }] }
    }
  }
  const idpRequested = normalized.aliasTags.includes('idp')
  const rawDraftType = String(data.draftType ?? '').trim().toLowerCase()

  if (formatId === 'redraft' && rawDraftType === 'slow_draft') {
    return {
      ok: false,
      error: 'Slow draft is controlled by draft clock settings, not a draft type',
      status: 400,
      errors: [
        {
          path: 'draftType',
          message: 'Choose snake, linear, auction, mock_draft, offline, or auto. Use a longer pick clock for a slow draft.',
        },
      ],
    }
  }

  if (idpRequested && !supportsIdpLeagueSport(sport)) {
    return {
      ok: false,
      error: 'IDP leagues are available only for NFL and NCAAF',
      status: 400,
      errors: [{ path: 'sport', message: `IDP is not supported for ${sport}` }],
    }
  }

  // A football scoring preset (it carries points per reception) on a non-football league is the
  // "NBA league scored as Half PPR" shape. The catalog check in the handler is skipped for a concept
  // the catalog does not list, so the invariant is enforced here, for every concept.
  if (receptionPointsForScoringPresetId(data.scoringPreset) != null && sport !== 'NFL' && sport !== 'NCAAF') {
    return {
      ok: false,
      error: 'Selected scoring preset is not available for this sport',
      status: 400,
      errors: [{ path: 'scoringPreset', message: `Scoring preset ${data.scoringPreset} is a football preset and is not valid for ${sport}` }],
    }
  }

  if (!isLeagueFormatAllowedForSport(sport, formatId)) {
    return {
      ok: false,
      error: 'This concept is not available for the selected sport',
      status: 400,
      errors: [{ path: 'concept', message: `Concept "${formatId}" is not valid for ${sport}` }],
    }
  }

  const engineBase = normalizeDraftTypeForEngineValidation(data.draftType)
  if (formatId === 'devy' && !isSupportedDevyCreateDraftType(data.draftType)) {
    return {
      ok: false,
      error: 'Invalid draft type for Devy leagues',
      status: 400,
      errors: [
        {
          path: 'draftType',
          message: 'Devy leagues support devy_snake, devy_linear, devy_auction, snake, linear, auction, mock_draft, offline, or auto',
        },
      ],
    }
  }
  if (idpRequested && !isAllowedIdpDraftType(data.draftType)) {
    return {
      ok: false,
      error: 'Invalid draft type for IDP leagues',
      status: 400,
      errors: [
        {
          path: 'draftType',
          message: 'IDP leagues support snake, linear, auction, offline, or auto',
        },
      ],
    }
  }
  const engineDraft = resolveEffectiveDraftTypeForConcept(formatId as LeagueTypeId, engineBase)
  if (!isDraftTypeAllowedForFormat(sport, formatId, engineDraft)) {
    return {
      ok: false,
      error: 'Invalid draft type for this concept and sport',
      status: 400,
      errors: [
        {
          path: 'draftType',
          message: `Draft type "${data.draftType}" is not allowed for ${formatId} / ${sport}`,
        },
      ],
    }
  }

  const teamOpts = getTeamCountOptions(sport as SupportedSport, formatId as LeagueTypeId, data.soccerPipeline ?? null)

  if (!teamOpts.includes(data.teamCount)) {
    return {
      ok: false,
      error: 'Invalid team count for this concept and sport',
      status: 400,
      errors: [
        {
          path: 'teamCount',
          message: `Team count must be one of: ${teamOpts.join(', ')}`,
        },
      ],
    }
  }

  const tePremiumPoints = data.conceptSetup?.tePremiumPoints
  if (tePremiumPoints !== undefined && tePremiumPoints !== null) {
    if (sport !== 'NFL' || !isValidTePremiumPoints(tePremiumPoints)) {
      const message = sport !== 'NFL'
        ? 'TE premium is available for NFL leagues'
        : `Choose a TE premium of ${TE_PREMIUM_POINT_OPTIONS.join(', ')} points per catch`
      return { ok: false, status: 400, error: message, errors: [{ path: 'conceptSetup.tePremiumPoints', message }] }
    }
  }

  if (formatId === 'survivor') {
    const tribeCount = data.conceptSetup?.survivorTribeCount
    if (tribeCount !== undefined && (typeof tribeCount !== 'number' || !getSurvivorTribeOptions(data.teamCount).includes(tribeCount))) {
      return { ok: false, status: 400, error: 'Choose a valid number of Survivor tribes for this cast size',
        errors: [{ path: 'conceptSetup.survivorTribeCount', message: 'Choose a valid number of Survivor tribes for this cast size' }] }
    }
    const role = data.conceptSetup?.commissionerParticipationMode
    if (role !== undefined && role !== 'participating_player' && role !== 'non_participating_host') {
      return { ok: false, status: 400, error: 'Choose whether the commissioner plays or hosts',
        errors: [{ path: 'conceptSetup.commissionerParticipationMode', message: 'Choose whether the commissioner plays or hosts' }] }
    }
  }

  if (stripped.strippedKeys.length > 0) {
    // non-fatal — caller may log
  }

  if (formatId === 'best_ball') {
    if (!isBestBallSupportedSport(sport)) {
      return {
        ok: false,
        error: 'Best Ball is not supported for this sport',
        status: 400,
        errors: [{ path: 'sport', message: `Best Ball is not available for ${sport}` }],
      }
    }
    const bestBall = normalizeBestBallSettings({
          teamCount: data.teamCount,
      sport,
      conceptSetup: (data.conceptSetup ?? null) as Record<string, unknown> | null,
      draftType: data.draftType,
      timezone: data.timezone ?? null,
      language: data.language ?? null,
    })
    if (bestBall.contestStructure === 'tournament') {
      try {
        const ends = tournamentRoundEnds(bestBall)
        if (ends.length === 1 && data.teamCount > bestBall.podSize) throw new Error('Add an advancement round when the field contains more than one pod')
        if (bestBall.scoringPeriod !== 'weekly') throw new Error('Tournament advancement currently requires weekly scoring')
        if (sport === 'NFL' && ends.at(-1)! > 18) throw new Error('NFL tournament rounds must finish by week 18')
      } catch (error) {
        return { ok: false, status: 400, error: (error as Error).message, errors: [{ path: 'conceptSetup.bestBall.roundEndWeeks', message: (error as Error).message }] }
      }
    }
    if (bestBall.mode === 'underdog' && (bestBall.waiversEnabled || bestBall.tradesEnabled || bestBall.substitutionsEnabled)) {
      return {
        ok: false,
        error: 'Underdog-style Best Ball does not allow waivers, trades, or manual substitutions',
        status: 400,
        errors: [
          {
            path: 'conceptSetup.bestBall',
            message: 'Underdog-style Best Ball must keep waivers, trades, and manual substitutions disabled',
          },
        ],
      }
    }
    if (bestBall.playoffTeams > data.teamCount) {
      return {
        ok: false,
        error: 'Playoff teams cannot exceed team count',
        status: 400,
        errors: [{ path: 'conceptSetup.bestBall.playoffTeams', message: 'Playoff teams cannot exceed the number of teams in the league' }],
      }
    }
  }

  if (formatId === 'survivor' && schedule.survivorTribeSlots !== undefined) {
    const count = Number(schedule.survivorTribeCount ?? 4)
    const message = validateTribeSlots(schedule.survivorTribeSlots, data.teamCount, count)
    if (message) return { ok: false, status: 400, error: message, errors: [{ path: 'conceptSetup.survivorTribeSlots', message }] }
  }
  if (formatId === 'survivor' && isSurvivorPlanSport(sport)) {
    try {
      if (schedule.survivorSeasonEndWeek !== undefined && typeof schedule.survivorSeasonEndWeek !== 'number') throw new Error('Survivor end week must be a number.')
      const draftAt = typeof date === 'string' && typeof time === 'string' ? toUtc(date, time, String(zone)) : undefined
      if (draftAt && draftAt.getTime() <= Date.now()) throw new Error('Choose a future Survivor draft date and time.')
      const exileSettings = normalizeSurvivorFoundationSettings(schedule)
      buildSurvivorFullSeasonPlan({ exileEnabled: exileSettings.exileIslandEnabled, exileReturnWeek: typeof schedule.exileReturnWeek === 'number' || typeof schedule.survivorExileReturnWeek === 'number' ? exileSettings.exileReturnWeek : undefined, finalistCount: readSurvivorLateSeasonSettings(schedule).finalistCount, sport, season: resolveLeagueCreationSeason(sport), castSize: data.teamCount, draftAt,
        endWeek: typeof schedule.survivorSeasonEndWeek === 'number' ? schedule.survivorSeasonEndWeek : undefined })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid Survivor season calendar'
      return { ok: false, status: 400, error: message, errors: [{ path: 'conceptSetup.survivorSeasonEndWeek', message }] }
    }
  }
  return { ok: true, data: { ...data, sport } }
}
