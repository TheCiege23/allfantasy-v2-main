/**
 * Decision OS — Phase 5.7 Intelligence API handler cores.
 *
 * Pure handler functions with an injected data provider. Route files are thin wrappers
 * that pass the real deps; tests inject fakes. No IO, no DB, no Next.js imports.
 *
 * Flow per handler:
 *   1. checkIntelligenceGate  → tier + requestId (or error response)
 *   2. hasScope               → 403 FORBIDDEN if tier lacks required scope
 *   3. param validation       → 400 INVALID_REQUEST if required params missing
 *   4. view param validation  → 400 INVALID_REQUEST if view is an unknown value
 *   5. dataProvider.get*(…)  → 503 INTELLIGENCE_UNAVAILABLE if null (Phase 5.7 stub)
 *   6. view=presentation      → IPM presentation response (Phase 7.2)
 *      view=raw / omitted     → IntelligenceApiResponse<T> via Phase 5.6 resolvers (unchanged)
 *
 * ADR: ADR_F5_7_INTELLIGENCE_API_ROUTES.md
 * ADR: ADR_F7_2_PRESENTATION_VIEW_MODE.md
 */

import type { ManagerBehavioralIntelligence } from '../manager-intelligence'
import type { LeagueBehavioralIntelligence }  from '../league-intelligence'
import type { PlatformBehavioralIntelligence } from '../platform-intelligence'
import {
  resolveManagerIntelligence,
  resolveLeagueIntelligence,
  resolveLeagueManagerSummaries,
  resolvePlatformIntelligenceBasic,
  resolvePlatformIntelligenceFull,
} from './resolvers'
import { getRecentLeagueSnapshots } from '../history/snapshots'
import { computeLeagueTrend } from '../history/trend'
import { deriveLeagueDeadlineIntelligence } from '../deadlines/deadlineIntelligence'
import {
  adaptLeagueBehavioralToPresentation,
  adaptManagerBehavioralToPresentation,
  adaptPlatformBehavioralToPresentation,
  PRESENTATION_VERSION,
} from './presentation-adapters'
import type {
  IntelligenceApiError,
  IntelligenceApiErrorCode,
  IntelligenceApiScope,
  IntelligenceTier,
  IntelligenceApiMeta,
  LeagueTrendV1,
  LeagueDeadlineV1,
} from './contracts'
import { TIER_SCOPE_MAP } from './contracts'
import { checkIntelligenceGate } from './gate'
import { resolveManagerDnaDirectory } from '@/lib/decision-os/managerDnaDirectory'

// ── Context ────────────────────────────────────────────────────────────────────

/**
 * Minimal request context — testable without NextRequest.
 * Compatible with `{ headers: req.headers, searchParams: new URL(req.url).searchParams }`.
 */
export interface IntelligenceApiContext {
  headers:      { get(key: string): string | null }
  searchParams: URLSearchParams
}

// ── Result ─────────────────────────────────────────────────────────────────────

export interface IntelligenceHandlerResult {
  status: number
  body:   unknown
}

// ── Data provider ─────────────────────────────────────────────────────────────

/**
 * Data source abstraction. Phase 5.7 ships `stubDataProvider` (returns null → 503).
 * Phase 5.8 replaces it with a real behavioral intelligence pipeline without changing
 * any route file or handler core.
 *
 * `getLeagueManagerIntelligences` (Phase 3.3) is additive — it does not change
 * either existing method's signature. It exists because `getLeagueIntelligence`'s
 * own real implementation already computes a per-manager array internally
 * (to derive the league aggregate) but never returned it; this method reuses
 * that same computation rather than deriving anything new.
 */
export interface IntelligenceDataProvider {
  getManagerIntelligence(
    managerId: string,
    leagueId:  string,
  ): Promise<ManagerBehavioralIntelligence | null>
  getLeagueIntelligence(leagueId: string): Promise<LeagueBehavioralIntelligence | null>
  getPlatformIntelligence():               Promise<PlatformBehavioralIntelligence | null>
  getLeagueManagerIntelligences(leagueId: string): Promise<ManagerBehavioralIntelligence[] | null>
}

/** Phase 5.7 stub — all methods return null; live requests return 503 until Phase 5.8. */
export const stubDataProvider: IntelligenceDataProvider = {
  getManagerIntelligence:  async () => null,
  getLeagueIntelligence:   async () => null,
  getPlatformIntelligence: async () => null,
  getLeagueManagerIntelligences: async () => null,
}

// ── View param ────────────────────────────────────────────────────────────────

/** Valid values for the `?view=` query parameter. */
export type IntelligenceViewParam = 'raw' | 'presentation'

const VALID_VIEW_VALUES: ReadonlySet<string> = new Set<IntelligenceViewParam>(['raw', 'presentation'])

/**
 * Parses and validates the `view` query parameter.
 * Returns `{ ok: true, view }` or `{ ok: false }` when the value is invalid.
 * Omitted view param is treated as `'raw'`.
 */
function parseViewParam(
  searchParams: URLSearchParams,
  requestId: string,
): { ok: true; view: IntelligenceViewParam } | { ok: false; result: IntelligenceHandlerResult } {
  const raw = searchParams.get('view')
  if (raw === null || raw === '') {
    return { ok: true, view: 'raw' }
  }
  if (VALID_VIEW_VALUES.has(raw)) {
    return { ok: true, view: raw as IntelligenceViewParam }
  }
  return {
    ok: false,
    result: errorResult(
      400,
      'INVALID_REQUEST',
      "Unknown view parameter value. Use 'presentation' or 'raw'.",
      requestId,
    ),
  }
}

// ── Presentation meta ──────────────────────────────────────────────────────────

/**
 * Extended meta block returned when view=presentation.
 * Extends IntelligenceApiMeta with presentation-layer version stamp.
 */
export interface PresentationApiMeta extends IntelligenceApiMeta {
  view: 'presentation'
  presentationVersion: string
}

export interface PresentationApiResponse<T> {
  data: T
  meta: PresentationApiMeta
}

function buildPresentationMeta(
  derivedAt: string,
  completeness: number,
  tier: IntelligenceTier,
  requestId: string,
): PresentationApiMeta {
  return {
    requestId,
    derivedAt,
    completeness,
    version: 'v1',
    tier,
    view: 'presentation',
    presentationVersion: PRESENTATION_VERSION,
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function errorResult(
  status:    number,
  code:      IntelligenceApiErrorCode,
  message:   string,
  requestId: string,
): IntelligenceHandlerResult {
  const body: IntelligenceApiError = { code, message, requestId }
  return { status, body }
}

function hasScope(tier: IntelligenceTier, required: IntelligenceApiScope): boolean {
  return (TIER_SCOPE_MAP[tier] as IntelligenceApiScope[]).includes(required)
}

function dataUnavailable(requestId: string): IntelligenceHandlerResult {
  return errorResult(503, 'INTELLIGENCE_UNAVAILABLE', 'Intelligence data is not available.', requestId)
}

// ── Platform handler ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/intelligence/platform
 *
 * Required scope: `intelligence:platform:basic` (all tiers pass).
 * Platform-tier callers additionally have `intelligence:platform:full` → full response.
 * All other tiers → basic aggregate-only response.
 *
 * view=presentation → PlatformApiPresentation (IPM shape)
 */
export async function platformIntelligenceHandler(
  ctx:          IntelligenceApiContext,
  dataProvider: IntelligenceDataProvider,
): Promise<IntelligenceHandlerResult> {
  const gate = checkIntelligenceGate(ctx.headers)
  if (!gate.ok) return { status: gate.status, body: gate.error }

  const { tier, requestId } = gate
  if (!hasScope(tier, 'intelligence:platform:basic')) {
    return errorResult(403, 'FORBIDDEN', 'API key does not have platform intelligence scope.', requestId)
  }

  const viewResult = parseViewParam(ctx.searchParams, requestId)
  if (!viewResult.ok) return viewResult.result
  const { view } = viewResult

  const intel = await dataProvider.getPlatformIntelligence()
  if (!intel) return dataUnavailable(requestId)

  if (view === 'presentation') {
    const data = adaptPlatformBehavioralToPresentation(intel)
    const meta = buildPresentationMeta(intel.derivedAt, intel.completeness, tier, requestId)
    return { status: 200, body: { data, meta } satisfies PresentationApiResponse<typeof data> }
  }

  const resolved = hasScope(tier, 'intelligence:platform:full')
    ? resolvePlatformIntelligenceFull(intel, requestId)
    : resolvePlatformIntelligenceBasic(intel, requestId)

  return { status: 200, body: resolved }
}

// ── League handler ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/intelligence/league?leagueId={id}
 *
 * Required scope: `intelligence:league:read` (commissioner + platform tiers).
 *
 * view=presentation → LeagueApiPresentation (IPM shape)
 */
export async function leagueIntelligenceHandler(
  ctx:          IntelligenceApiContext,
  dataProvider: IntelligenceDataProvider,
): Promise<IntelligenceHandlerResult> {
  const gate = checkIntelligenceGate(ctx.headers)
  if (!gate.ok) return { status: gate.status, body: gate.error }

  const { tier, requestId } = gate
  if (!hasScope(tier, 'intelligence:league:read')) {
    return errorResult(403, 'FORBIDDEN', 'API key does not have league intelligence scope.', requestId)
  }

  const leagueId = ctx.searchParams.get('leagueId')?.trim() ?? ''
  if (!leagueId) {
    return errorResult(400, 'INVALID_REQUEST', 'Missing required query parameter: leagueId.', requestId)
  }

  const viewResult = parseViewParam(ctx.searchParams, requestId)
  if (!viewResult.ok) return viewResult.result
  const { view } = viewResult

  const intel = await dataProvider.getLeagueIntelligence(leagueId)
  if (!intel) return dataUnavailable(requestId)

  if (view === 'presentation') {
    const data = adaptLeagueBehavioralToPresentation(intel)
    const meta = buildPresentationMeta(intel.derivedAt, intel.completeness, tier, requestId)
    return { status: 200, body: { data, meta } satisfies PresentationApiResponse<typeof data> }
  }

  return { status: 200, body: resolveLeagueIntelligence(intel, requestId, tier) }
}

// ── League managers handler (Phase 3.3) ───────────────────────────────────────

/**
 * GET /api/v1/intelligence/league/managers?leagueId={id}
 *
 * Required scope: `intelligence:league:read` (commissioner + platform tiers) —
 * same tier as the league route itself; this is manager data scoped to one
 * league, not a new permission concept. No `view=presentation` — this is a
 * new, narrower capability (a public listing that never existed before), not
 * an extension of the existing raw/presentation duality.
 */
export async function leagueManagersIntelligenceHandler(
  ctx:          IntelligenceApiContext,
  dataProvider: IntelligenceDataProvider,
): Promise<IntelligenceHandlerResult> {
  const gate = checkIntelligenceGate(ctx.headers)
  if (!gate.ok) return { status: gate.status, body: gate.error }

  const { tier, requestId } = gate
  if (!hasScope(tier, 'intelligence:league:read')) {
    return errorResult(403, 'FORBIDDEN', 'API key does not have league intelligence scope.', requestId)
  }

  const leagueId = ctx.searchParams.get('leagueId')?.trim() ?? ''
  if (!leagueId) {
    return errorResult(400, 'INVALID_REQUEST', 'Missing required query parameter: leagueId.', requestId)
  }

  const managerIntelligences = await dataProvider.getLeagueManagerIntelligences(leagueId)
  if (!managerIntelligences) return dataUnavailable(requestId)

  return { status: 200, body: resolveLeagueManagerSummaries(managerIntelligences, requestId, tier) }
}

// ── League trend handler (Phase 3.3) ──────────────────────────────────────────

/**
 * GET /api/v1/intelligence/league/trend?leagueId={id}
 *
 * Required scope: `intelligence:league:read`. Does not go through
 * `IntelligenceDataProvider` — trend is a comparison of stored historical
 * snapshots (`intelligence_league_snapshot_history`), not event-derived
 * behavioral intelligence, so there is no stub/real swap the same way; the
 * honest "insufficient_historical_data" state occurs naturally whenever
 * fewer than 2 snapshots exist, in every environment, without a separate
 * stub path.
 */
export async function leagueTrendIntelligenceHandler(
  ctx: IntelligenceApiContext,
): Promise<IntelligenceHandlerResult> {
  const gate = checkIntelligenceGate(ctx.headers)
  if (!gate.ok) return { status: gate.status, body: gate.error }

  const { tier, requestId } = gate
  if (!hasScope(tier, 'intelligence:league:read')) {
    return errorResult(403, 'FORBIDDEN', 'API key does not have league intelligence scope.', requestId)
  }

  const leagueId = ctx.searchParams.get('leagueId')?.trim() ?? ''
  if (!leagueId) {
    return errorResult(400, 'INVALID_REQUEST', 'Missing required query parameter: leagueId.', requestId)
  }

  const points = await getRecentLeagueSnapshots(leagueId, 2)
  const result = computeLeagueTrend(points)
  const data: LeagueTrendV1 = result.available
    ? { available: true, ...result.trend }
    : { available: false, reason: result.reason, snapshotCount: result.snapshotCount }
  const completeness = result.available ? 100 : 0
  const derivedAt = result.available ? result.trend.capturedAt : new Date().toISOString()

  return {
    status: 200,
    body: { data, meta: { requestId, derivedAt, completeness, version: 'v1', tier } satisfies IntelligenceApiMeta },
  }
}

// ── League Manager DNA directory handler ───────────────────────────

/**
 * GET /api/v1/intelligence/league/manager-dna?leagueId={id}
 *
 * Every manager's Phase 6.2 DNA classification for one league - the directory the per-manager
 * route deliberately withholds by narrowing to the caller's own profile.
 *
 * Required scope: `intelligence:league:read`, which `TIER_SCOPE_MAP` grants to the **commissioner
 * and platform tiers only**. That is the authorization decision this endpoint rests on, and it is
 * an existing one rather than a new one: a manager-tier key holds `intelligence:manager:read` and
 * is refused here, which is exactly the boundary a directory of other people's behavioural profiles
 * needs. No new role concept, no second gate to keep in sync with the first.
 *
 * Bypasses `IntelligenceDataProvider` for the same reason the trend and deadline handlers do: the
 * DNA pipeline is its own composition (Phase 5.1/5.2 -> 6.1/6.2), not the event-derived
 * `ManagerBehavioralIntelligence` those methods return. There is no stub/real swap to preserve -
 * the honest "insufficient data" state arises naturally as `primaryIdentity: 'unknown'` per row,
 * in every environment.
 */
export async function leagueManagerDnaIntelligenceHandler(
  ctx: IntelligenceApiContext,
): Promise<IntelligenceHandlerResult> {
  const gate = checkIntelligenceGate(ctx.headers)
  if (!gate.ok) return { status: gate.status, body: gate.error }

  const { tier, requestId } = gate
  if (!hasScope(tier, 'intelligence:league:read')) {
    return errorResult(403, 'FORBIDDEN', 'API key does not have league intelligence scope.', requestId)
  }

  const leagueId = ctx.searchParams.get('leagueId')?.trim() ?? ''
  if (!leagueId) {
    return errorResult(400, 'INVALID_REQUEST', 'Missing required query parameter: leagueId.', requestId)
  }

  const directory = await resolveManagerDnaDirectory({ leagueId })
  if (!directory.available) return dataUnavailable(requestId)

  // Mean of the per-row input-quality scores, not a headline confidence: an empty league is 0
  // rather than 100, so "nothing to report" never reads as "perfectly complete".
  const completeness =
    directory.rows.length === 0
      ? 0
      : Math.round(directory.rows.reduce((sum, r) => sum + r.completeness, 0) / directory.rows.length)

  return {
    status: 200,
    body: {
      data: directory,
      meta: {
        requestId,
        derivedAt: new Date().toISOString(),
        completeness,
        version: 'v1',
        tier,
      } satisfies IntelligenceApiMeta,
    },
  }
}

// ── League deadlines handler (Phase 3.3) ──────────────────────────────────────

/**
 * GET /api/v1/intelligence/league/deadlines?leagueId={id}
 *
 * Required scope: `intelligence:league:read`. Also bypasses
 * `IntelligenceDataProvider` — deadlines come from `League`/`LeagueSettings`
 * configuration + the app's own existing `resolveCurrentWeek`, not from the
 * behavioral-events pipeline.
 */
export async function leagueDeadlineIntelligenceHandler(
  ctx: IntelligenceApiContext,
): Promise<IntelligenceHandlerResult> {
  const gate = checkIntelligenceGate(ctx.headers)
  if (!gate.ok) return { status: gate.status, body: gate.error }

  const { tier, requestId } = gate
  if (!hasScope(tier, 'intelligence:league:read')) {
    return errorResult(403, 'FORBIDDEN', 'API key does not have league intelligence scope.', requestId)
  }

  const leagueId = ctx.searchParams.get('leagueId')?.trim() ?? ''
  if (!leagueId) {
    return errorResult(400, 'INVALID_REQUEST', 'Missing required query parameter: leagueId.', requestId)
  }

  const intel = await deriveLeagueDeadlineIntelligence(leagueId)
  if (!intel) return dataUnavailable(requestId)

  const data: LeagueDeadlineV1 = {
    leagueId: intel.leagueId,
    season: intel.season,
    currentWeek: intel.currentWeek,
    tradeDeadline: intel.tradeDeadline,
    playoffsStart: intel.playoffsStart,
    draft: intel.draft,
    nextWaiverProcessing: intel.nextWaiverProcessing,
    nextActionableEvent: intel.nextActionableEvent,
  }

  return {
    status: 200,
    body: { data, meta: { requestId, derivedAt: intel.derivedAt, completeness: 100, version: 'v1', tier } satisfies IntelligenceApiMeta },
  }
}

// ── Manager handler ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/intelligence/manager?leagueId={id}&managerId={id}
 *
 * Required scope: `intelligence:manager:read` (manager + platform tiers).
 *
 * view=presentation → ManagerApiPresentation (IPM shape)
 */
export async function managerIntelligenceHandler(
  ctx:          IntelligenceApiContext,
  dataProvider: IntelligenceDataProvider,
): Promise<IntelligenceHandlerResult> {
  const gate = checkIntelligenceGate(ctx.headers)
  if (!gate.ok) return { status: gate.status, body: gate.error }

  const { tier, requestId } = gate
  if (!hasScope(tier, 'intelligence:manager:read')) {
    return errorResult(403, 'FORBIDDEN', 'API key does not have manager intelligence scope.', requestId)
  }

  const leagueId  = ctx.searchParams.get('leagueId')?.trim()  ?? ''
  const managerId = ctx.searchParams.get('managerId')?.trim() ?? ''

  if (!leagueId) {
    return errorResult(400, 'INVALID_REQUEST', 'Missing required query parameter: leagueId.', requestId)
  }
  if (!managerId) {
    return errorResult(400, 'INVALID_REQUEST', 'Missing required query parameter: managerId.', requestId)
  }

  const viewResult = parseViewParam(ctx.searchParams, requestId)
  if (!viewResult.ok) return viewResult.result
  const { view } = viewResult

  const intel = await dataProvider.getManagerIntelligence(managerId, leagueId)
  if (!intel) return dataUnavailable(requestId)

  if (view === 'presentation') {
    const data = adaptManagerBehavioralToPresentation(intel)
    const meta = buildPresentationMeta(intel.derivedAt, intel.completeness, tier, requestId)
    return { status: 200, body: { data, meta } satisfies PresentationApiResponse<typeof data> }
  }

  return { status: 200, body: resolveManagerIntelligence(intel, requestId, tier) }
}
