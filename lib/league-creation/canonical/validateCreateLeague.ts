/**
 * Create League (canonical) — request validation before preset engine + transaction.
 */

import { z } from 'zod'
import { resolveDynastyCreationRoster } from './dynastyCreationRoster'
import { isValidIanaTimeZone, toUtc } from '@/lib/timezone'
import type { LeagueSport } from '@prisma/client'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
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
import type { SupportedSport } from '@/lib/create-league-v2/state'
import type { ValidationIssue } from '@/lib/league-creation/canonical/types'
import {
  isBestBallSupportedSport,
  normalizeBestBallSettings,
} from '@/lib/bestball/rules'
import { isSupportedDevyCreateDraftType } from '@/lib/league-concepts/devyDefaults'

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

/** Stable code for the Option B launch gate on college-format (devy/c2c) creation. */
export const COLLEGE_FORMATS_NOT_OPEN_CODE = 'COLLEGE_FORMATS_NOT_OPEN'
export const COLLEGE_FORMATS_NOT_OPEN_MESSAGE =
  'College formats are not yet open — devy rounds are available on dynasty leagues'

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
      sport,
      conceptSetup: (data.conceptSetup ?? null) as Record<string, unknown> | null,
      draftType: data.draftType,
      timezone: data.timezone ?? null,
      language: data.language ?? null,
    })
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

  // Option B (launch): college formats are draft-only — dynasty carries the
  // devy rounds. The wizard already hides devy/c2c; this closes the bare-API
  // path. Runs LAST so devy/c2c payloads still get specific draft-type and
  // team-count diagnostics, and can never reach `ok: true`.
  if (formatId === 'devy' || formatId === 'c2c') {
    return {
      ok: false,
      error: COLLEGE_FORMATS_NOT_OPEN_MESSAGE,
      status: 400,
      errors: [
        {
          path: 'concept',
          message: COLLEGE_FORMATS_NOT_OPEN_MESSAGE,
          code: COLLEGE_FORMATS_NOT_OPEN_CODE,
        },
      ],
    }
  }

  return { ok: true, data: { ...data, sport } }
}