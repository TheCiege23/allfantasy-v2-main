/**
 * Create League v2 — submit handler.
 *
 * Routing:
 *   - tournament → POST /api/tournament/create
 *   - all other formats → POST /api/leagues (canonical preset engine + Prisma transaction)
 */

import type { CreateLeagueV2State } from './state'
import { getDefaultKeeperSetup } from './state'
import { getEffectiveLeagueType, isFootballLike, isDynastyConcept } from './state'
import { finalizeCanonicalCreatePayload } from '@/lib/league-creation/normalizeCreateLeaguePayload'
import { resolveEffectiveDraftType, isThirdRoundReversalAvailable } from '@/lib/create-league-v2/rules-engine'
import { buildPostCreateLeagueHomeHref } from '@/lib/league/post-create-navigation'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import { normalizeBestBallSettings } from '@/lib/bestball/rules'
import { trackMetaEventsFromResponse } from '@/lib/meta-client'
import { getEnabledPremiumAdvancedSettings } from '@/lib/create-league-v2/simple-create'

/** Execution modes must stay verbatim on the wire so persistence keeps isOffline / isAuto flags. */
const EXECUTION_DRAFT_IDS = new Set(['offline', 'auto', 'team'])

/**
 * Maps wizard draft ids to format-engine ids for POST /api/leagues.
 * Devy/C2C: snake → devy_snake / c2c_snake, auction → devy_auction / c2c_auction (see resolveEffectiveDraftType).
 */
function canonicalDraftTypeForApi(state: CreateLeagueV2State): string {
  const lt = getEffectiveLeagueType(state) as LeagueTypeId
  const raw = state.draftType
  const lower = String(raw).toLowerCase()
  if (lt !== 'devy' && lt !== 'c2c') {
    return raw
  }
  if (EXECUTION_DRAFT_IDS.has(lower)) {
    return raw
  }
  return resolveEffectiveDraftType(lt, raw)
}

/** Maps API validation `path` (e.g. teamCount) → message for inline UI. */
export type CreateLeagueFieldErrors = Partial<Record<string, string>>

export interface CreateLeagueV2Result {
  ok: boolean
  leagueId?: string
  error?: string
  redirectTo?: string
  fieldErrors?: CreateLeagueFieldErrors
}

// ── Endpoint routing ────────────────────────────────────────────────

function getEndpoint(state: CreateLeagueV2State): string {
  const lt = getEffectiveLeagueType(state)
  if (lt === 'tournament') return '/api/tournament/create'
  return '/api/leagues'
}

// ── Canonical API (POST /api/leagues) ───────────────────────────────

/**
 * Body matches `createLeagueBodySchema` / `validateCreatePayload` on the server.
 * `concept` uses format ids; IDP is sent as `idp` (maps to redraft shell + IDP modifiers server-side).
 */
function buildCanonicalPayload(state: CreateLeagueV2State): Record<string, unknown> {
  const lt = getEffectiveLeagueType(state) as LeagueTypeId
  const concept = state.idpSelected ? 'idp' : lt

  const conceptSetup: Record<string, unknown> = {
    visibility: state.privacy,
    isPublic: state.privacy === 'public',
    draftDate: state.draftDate,
    draftTime: state.draftTime,
    draftTimezone: state.timezone,
  }

  const enabledPremiumAdvancedSettings = getEnabledPremiumAdvancedSettings(state.advancedSetup)
  if (enabledPremiumAdvancedSettings.length > 0) {
    conceptSetup.advancedSetup = Object.fromEntries(
      enabledPremiumAdvancedSettings.map((key) => [key, true]),
    )
  }
  if (lt === 'survivor') {
    conceptSetup.survivorTribeCount = state.survivorTribeCount
  }
  if (isFootballLike(state.sport) && state.thirdRoundReversal && isThirdRoundReversalAvailable(state.draftType)) {
    conceptSetup.thirdRoundReversal = true
  }
  if (isDynastyConcept(lt) && state.dynasty) {
    const d = state.dynasty
    conceptSetup.taxiSlots = d.taxiSlotCount
    conceptSetup.taxiEligibilityYears = d.taxiEligibilityYears
    conceptSetup.taxiLockDeadlineWeek = d.taxiLockDeadlineWeek
    conceptSetup.taxiAllowNonRookies = d.taxiAllowNonRookies
    conceptSetup.taxiAllowMoveOutAfterDeadline = d.taxiAllowMoveOutAfterDeadline
    conceptSetup.rookieDraftRounds = d.rookieDraftRounds
    conceptSetup.rookieDraftType = d.rookieDraftType
    conceptSetup.rookieDraftOrderMethod = d.rookieDraftOrderMethod
    conceptSetup.futurePicksYearsOut = d.futurePickTradeYears
    conceptSetup.regularSeasonWeeks = d.regularSeasonLength
    conceptSetup.playoffTeamCount = d.playoffTeamCount
    conceptSetup.playoffByeCount = d.playoffByeCount
    conceptSetup.waiverTypeRecommended = d.waiverType
    conceptSetup.faabBudget = d.faabBudget
    conceptSetup.divisionCount = d.divisionCount
    conceptSetup.commissionerAi = d.commissionerAi
    conceptSetup.userAi = d.userAi
    if (d.introVideoUrl) conceptSetup.introVideoUrl = d.introVideoUrl
  }

  if (lt === 'keeper' && state.keeper) {
    const k = state.keeper ?? getDefaultKeeperSetup()
    conceptSetup.keeper_max_keepers = k.keeperMaxKeepers
    conceptSetup.keeperMaxKeepers = k.keeperMaxKeepers
    conceptSetup.keeper_max_years = k.keeperMaxYears
    conceptSetup.keeper_round_penalty = k.keeperRoundPenalty
    conceptSetup.keeper_waiver_allowed = k.keeperWaiverAllowed
    conceptSetup.keeper_eligibility_rule = k.keeperEligibilityRule
    if (k.introVideoUrl?.trim()) conceptSetup.introVideoUrl = k.introVideoUrl.trim()
    if (k.introPosterUrl?.trim()) conceptSetup.introPosterUrl = k.introPosterUrl.trim()
  }

  if (lt === 'best_ball' && state.bestBall) {
    const bestBall = normalizeBestBallSettings({
      sport: state.sport,
      draftType: state.draftType,
      timezone: state.timezone,
      language: state.language,
      conceptSetup: { bestBall: state.bestBall },
    })
    conceptSetup.bestBall = bestBall
  }

  const apiDraftType = canonicalDraftTypeForApi(state)

  const tradeReviewMode =
    state.tradeReviewMode === 'none'
      ? 'none'
      : state.tradeReviewMode === 'league_vote'
        ? 'league_vote'
        : 'commissioner'

  const payload: Record<string, unknown> = {
    concept,
    sport: state.sport,
    scoringPreset: state.scoringPresetId,
    teamCount: state.teamCount,
    draftType: apiDraftType,
    leagueName: state.name.trim(),
    timezone: state.timezone,
    language: state.language === 'es' ? 'es' : 'en',
    tradeReviewMode,
    ...(state.sport === 'SOCCER' && state.soccerPipeline ? { soccerPipeline: state.soccerPipeline } : {}),
  }

  if (Object.keys(conceptSetup).length > 0) {
    payload.conceptSetup = conceptSetup
  }

  return finalizeCanonicalCreatePayload(payload)
}

function buildTournamentPayload(state: CreateLeagueV2State) {
  return {
    name: state.name.trim(),
    sport: state.sport,
    settings: {
      participantPoolSize: state.tournamentPoolSize || 32,
      initialLeagueSize: 12,
      draftType: state.draftType === 'auction' ? 'auction' : 'snake',
      leagueNamingMode: 'app_generated',
    },
  }
}

// ── Response parsing ────────────────────────────────────────────────

function parseRedirectUrl(state: CreateLeagueV2State, json: Record<string, unknown>): string {
  const lt = getEffectiveLeagueType(state) ?? 'redraft'
  if (typeof json.homepageUrl === 'string' && json.homepageUrl.length > 0) return json.homepageUrl

  const leagueIds = json.leagueIds
  const firstFeederLeagueId =
    Array.isArray(leagueIds) && leagueIds.length > 0 && typeof leagueIds[0] === 'string'
      ? leagueIds[0]
      : undefined

  if (typeof json.tournamentId === 'string') {
    return buildPostCreateLeagueHomeHref({
      leagueType: 'tournament',
      leagueId: firstFeederLeagueId,
      tournamentId: json.tournamentId,
      allowInviteLink: true,
    })
  }

  const leagueId =
    (typeof json.leagueId === 'string' ? json.leagueId : null) ??
    firstFeederLeagueId ??
    (json.league && typeof json.league === 'object' && json.league !== null && 'id' in json.league
      ? String((json.league as { id: string }).id)
      : null)

  if (leagueId) {
    return buildPostCreateLeagueHomeHref({
      leagueId,
      leagueType: lt,
      allowInviteLink: true,
    })
  }

  return '/dashboard'
}

function parseLeagueId(json: Record<string, unknown>): string | undefined {
  if (typeof json.leagueId === 'string') return json.leagueId
  const leagueIds = json.leagueIds
  if (Array.isArray(leagueIds) && leagueIds.length > 0 && typeof leagueIds[0] === 'string') {
    return leagueIds[0]
  }
  if (json.league && typeof json.league === 'object' && json.league !== null && 'id' in json.league) {
    return String((json.league as { id: string }).id)
  }
  return undefined
}

function parseFieldErrors(json: Record<string, unknown>): CreateLeagueFieldErrors {
  const out: CreateLeagueFieldErrors = {}
  const raw = Array.isArray(json.errors)
    ? json.errors
    : Array.isArray(json.issues)
      ? json.issues
      : Array.isArray(json.details)
        ? json.details
      : []
  for (const item of raw as { path?: string; message?: string }[]) {
    const msg = typeof item?.message === 'string' ? item.message : ''
    if (!msg) continue
    let key = 'general'
    if (typeof item.path === 'string' && item.path.length > 0) {
      key = item.path.split('.')[0] ?? 'general'
    }
    if (key === 'request' || key === 'body') key = 'general'
    if (!out[key]) out[key] = msg
  }
  return out
}

function issuesToMessage(raw: unknown): string {
  if (!Array.isArray(raw)) return ''
  const msgs = raw
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && typeof (item as { message?: unknown }).message === 'string') {
        return String((item as { message: string }).message)
      }
      return null
    })
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return msgs.join('; ')
}

function formatErrorJson(json: Record<string, unknown>, resStatus: number): string {
  if (typeof json.message === 'string' && json.message.trim().length > 0) return json.message
  if (typeof json.error === 'string' && json.error.trim().length > 0) return json.error
  if (typeof json.details === 'string' && json.details.trim().length > 0) return json.details

  const detailsObjectMessage =
    json.details && typeof json.details === 'object' && !Array.isArray(json.details)
      ? (json.details as { message?: unknown }).message
      : null
  if (typeof detailsObjectMessage === 'string' && detailsObjectMessage.trim().length > 0) {
    return detailsObjectMessage
  }

  const issuesFromJson = issuesToMessage(json.issues)
  if (issuesFromJson) return issuesFromJson

  const detailsFromJson = issuesToMessage(json.details)
  if (detailsFromJson) return detailsFromJson

  const fromErrors = Array.isArray(json.errors)
    ? (json.errors as { message?: string }[])
        .map((e) => (typeof e?.message === 'string' ? e.message : null))
        .filter(Boolean)
        .join('; ')
    : ''
  if (fromErrors) return fromErrors

  if (typeof json.detail === 'string' && json.detail.trim().length > 0) return json.detail
  return `Create league failed (${resStatus})`
}

function summarizeSubmittedPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { payloadType: typeof payload }
  }

  const body = payload as Record<string, unknown>
  const conceptSetup =
    body.conceptSetup && typeof body.conceptSetup === 'object' && !Array.isArray(body.conceptSetup)
      ? (body.conceptSetup as Record<string, unknown>)
      : null

  const visibility =
    typeof conceptSetup?.visibility === 'string'
      ? conceptSetup.visibility
      : conceptSetup?.isPublic === true
        ? 'public'
        : conceptSetup?.bestBall && typeof conceptSetup.bestBall === 'object'
          ? (conceptSetup.bestBall as Record<string, unknown>).visibility ?? null
          : null

  return {
    concept: typeof body.concept === 'string' ? body.concept : null,
    sport: typeof body.sport === 'string' ? body.sport : null,
    draftType: typeof body.draftType === 'string' ? body.draftType : null,
    scoringPreset:
      typeof body.scoringPreset === 'string'
        ? body.scoringPreset
        : typeof body.scoringPresetId === 'string'
          ? body.scoringPresetId
          : null,
    teamCount: typeof body.teamCount === 'number' ? body.teamCount : null,
    leagueName: typeof body.leagueName === 'string' ? body.leagueName : typeof body.name === 'string' ? body.name : null,
    timezone: typeof body.timezone === 'string' ? body.timezone : null,
    visibility,
    hasConceptSetup: Boolean(conceptSetup),
  }
}

// ── Main submit ─────────────────────────────────────────────────────

export async function submitCreateLeagueV2(state: CreateLeagueV2State): Promise<CreateLeagueV2Result> {
  if (!getEffectiveLeagueType(state)) {
    return { ok: false, error: 'Choose a league concept to continue.' }
  }
  if (!state.scoringPresetId?.trim()) {
    return { ok: false, error: 'Choose a scoring preset.' }
  }

  const endpoint = getEndpoint(state)

  let payload: unknown
  if (endpoint === '/api/tournament/create') {
    payload = buildTournamentPayload(state)
  } else {
    payload = buildCanonicalPayload(state)
  }

  if (process.env.NODE_ENV === 'development') {
    console.info('[create-league-v2] normalized payload preview', summarizeSubmittedPayload(payload))
  }

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('[create-league-v2] create request network failure', {
      requestUrl: endpoint,
      responseStatus: null,
      responseJson: null,
      payloadSummary: summarizeSubmittedPayload(payload),
      error: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }

  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    // Body may be empty or non-JSON
  }

  if (!res.ok) {
    console.error('[create-league-v2] create request failed', {
      requestUrl: endpoint,
      responseStatus: res.status,
      responseJson: json,
      payloadSummary: summarizeSubmittedPayload(payload),
    })
    return {
      ok: false,
      error: formatErrorJson(json, res.status),
      fieldErrors: parseFieldErrors(json),
    }
  }

  if (json.success === false) {
    console.error('[create-league-v2] create response success=false', {
      requestUrl: endpoint,
      responseStatus: res.status,
      responseJson: json,
      payloadSummary: summarizeSubmittedPayload(payload),
    })
    return {
      ok: false,
      error: formatErrorJson(json, res.status),
      fieldErrors: parseFieldErrors(json),
    }
  }

  const leagueId = parseLeagueId(json)
  const redirectTo = parseRedirectUrl(state, json)
  trackMetaEventsFromResponse(json)

  return { ok: true, leagueId, redirectTo }
}
