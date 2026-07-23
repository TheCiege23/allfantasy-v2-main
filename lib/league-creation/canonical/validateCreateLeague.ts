/**
 * Create League (canonical) — request validation before preset engine + transaction.
 */

import { z } from 'zod'
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
  timezone: z.string().min(1).max(64).optional(),
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

  return { ok: true, data: { ...data, sport } }
}