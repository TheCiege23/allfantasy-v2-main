import { z } from 'zod'
import { DRAFT_TYPES_REDRAFT } from '@/lib/redraft-creation/constants'
import { getRedraftMaxTeams } from '@/lib/redraft-creation/sport-config'
import { clampRedraftTeamCount } from '@/lib/redraft-creation/team-limits'
import { isSupportedSport } from '@/lib/sport-scope'

/** Client must never send an authoritative user id — leagues.userId comes from the session only. */
export const FORBIDDEN_REDRAFT_BODY_USER_KEYS = [
  'userId',
  'user_id',
  'commissionerUserId',
  'commissionerId',
  'ownerUserId',
  'appUserId',
] as const

export type StripForbiddenUserFieldsResult = {
  body: unknown
  /** Keys that were present and removed (for logging). */
  strippedKeys: string[]
}

export function stripForbiddenUserFieldsFromRedraftBody(input: unknown): StripForbiddenUserFieldsResult {
  if (!input || typeof input !== 'object') {
    return { body: input, strippedKeys: [] }
  }
  const o = { ...(input as Record<string, unknown>) }
  const strippedKeys: string[] = []
  for (const k of FORBIDDEN_REDRAFT_BODY_USER_KEYS) {
    if (k in o && o[k] !== undefined) {
      strippedKeys.push(k)
      delete o[k]
    }
  }
  if (typeof o.leagueType === 'string') {
    o.leagueType = o.leagueType.trim().toLowerCase()
  }
  return { body: o, strippedKeys }
}

/** Accepts `redraft` or `REDRAFT` (checklist / clients may send uppercase). */
function normalizeRedraftBody(input: unknown): unknown {
  return stripForbiddenUserFieldsFromRedraftBody(input).body
}

export const redraftCreateBodySchema = z.object({
  leagueType: z.literal('redraft'),
  sport: z.enum(['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']),
  soccerPipeline: z.enum(['mls', 'euro']).optional().nullable(),
  draftType: z.enum(['snake', 'linear', 'auction', 'offline', 'auto']),
  name: z.string().min(1, 'League name is required').max(100),
  timezone: z.string().min(1, 'Timezone is required'),
  language: z.enum(['en', 'es']),
  tradeReviewMode: z.enum(['commissioner', 'league_vote', 'instant']),
  teamCount: z.number().int().min(4),
})

export type RedraftCreateBody = z.infer<typeof redraftCreateBodySchema>

export type RedraftValidationIssue = { path: string; message: string }

export function validateRedraftCreatePayload(input: unknown):
  | { ok: true; data: RedraftCreateBody }
  | { ok: false; error: string; status: number; issues: RedraftValidationIssue[] } {
  const parsed = redraftCreateBodySchema.safeParse(normalizeRedraftBody(input))
  if (!parsed.success) {
    const issues: RedraftValidationIssue[] = parsed.error.issues.map((i) => {
      const path = i.path.join('.') || 'request'
      let message = i.message
      // zod 4 reports a failed z.enum as `invalid_value` (v3 called it `invalid_enum_value`).
      if (i.code === 'invalid_value') {
        if (i.path[0] === 'sport') message = 'Invalid sport'
        else if (i.path[0] === 'draftType') message = 'Invalid draft type'
      }
      return { path, message }
    })
    const msg = issues[0]?.message ?? 'Invalid request'
    return { ok: false, error: msg, status: 400, issues }
  }
  const data = parsed.data
  if (!isSupportedSport(data.sport)) {
    return {
      ok: false,
      error: 'Selected sport is not supported',
      status: 400,
      issues: [{ path: 'sport', message: 'Selected sport is not supported' }],
    }
  }
  if (data.sport === 'SOCCER' && !data.soccerPipeline) {
    return {
      ok: false,
      error: 'Choose MLS or European pipeline for Soccer',
      status: 400,
      issues: [{ path: 'soccerPipeline', message: 'Choose MLS or European pipeline for Soccer' }],
    }
  }
  if (data.sport !== 'SOCCER' && data.soccerPipeline) {
    return {
      ok: false,
      error: 'Soccer pipeline is only valid for Soccer',
      status: 400,
      issues: [{ path: 'soccerPipeline', message: 'Soccer pipeline is only valid for Soccer' }],
    }
  }
  if (!DRAFT_TYPES_REDRAFT.includes(data.draftType)) {
    return {
      ok: false,
      error: 'Selected draft type is not supported for redraft',
      status: 400,
      issues: [{ path: 'draftType', message: 'Selected draft type is not supported for redraft' }],
    }
  }
  const max = getRedraftMaxTeams(data.sport, data.soccerPipeline ?? null)
  if (data.teamCount < 4 || data.teamCount > max) {
    return {
      ok: false,
      error: `Team count must be between 4 and ${max} for the selected sport`,
      status: 400,
      issues: [{ path: 'teamCount', message: `Must be between 4 and ${max}` }],
    }
  }
  const clamped = clampRedraftTeamCount(data.sport, data.teamCount, data.soccerPipeline ?? null)
  return { ok: true, data: { ...data, teamCount: clamped } }
}
