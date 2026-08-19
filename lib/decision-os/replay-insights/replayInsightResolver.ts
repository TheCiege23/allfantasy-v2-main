/**
 * Decision OS Replay Framework Phase 18 — Manager OS Replay Insight resolver.
 *
 * A thin, READ-ONLY handler that exposes the Phase 17 `ManagerReplayInsightSetV1`
 * contract for one real league behind the existing Decision OS intelligence-API
 * auth/tenant gate (`lib/decision-os/behavioral/api/gate.ts`). It is the
 * "Manager-OS-owned resolver (outside lib/replay-framework/)" that the Phase 17
 * ADR §7 specified: production imports the replay *contract + formatter*, never
 * the replay internals — the isolation direction stays one-way.
 *
 * Design (mirrors lib/decision-os/behavioral/api/intelligence-handlers.ts):
 *   - The handler is PURE and takes an injected `ReplayInsightDataProvider`, so
 *     it is testable with zero DB access. Route/wiring layers pass the live
 *     provider; tests pass a fake.
 *   - The live provider is the only IO boundary — it calls the read-only
 *     Phase 15/16 `computeDecisionReplayCorrelation()` (two `findMany`s, zero
 *     writes). No production recommendation logic, Trade Learning, or
 *     calibration is touched anywhere in this path.
 *   - The user-facing body is exactly `ManagerReplayInsightSetV1` (Phase 17) —
 *     already leak-proof by construction (the formatter never reads
 *     `perTradeImpacts`), so no replay/league/roster/player IDs can reach the
 *     caller through this resolver.
 *
 * Boundary restated (Phase 17 ADR §2, unchanged): this surfaces a *validated
 * insight* (a description of a measured historical pattern), NOT a production
 * *recommendation* (an instruction the live system stands behind). Nothing here
 * feeds a live recommendation, and no route imports this yet.
 *
 * ADR: docs/DECISION_OS_MANAGER_REPLAY_INSIGHT_ADR.md (§9, Phase 18 addendum)
 */
import type { IntelligenceApiError, IntelligenceApiErrorCode, IntelligenceApiScope, IntelligenceTier } from '../behavioral/api/contracts'
import { TIER_SCOPE_MAP } from '../behavioral/api/contracts'
import { checkIntelligenceGate } from '../behavioral/api/gate'
import type { DecisionReplayCorrelationSummary } from '@/lib/replay-framework/metrics/decisionReplayCorrelation'
import { computeDecisionReplayCorrelation } from '@/lib/replay-framework/metrics/decisionReplayCorrelation'
import { buildManagerReplayInsights, type ManagerReplayInsightSetV1 } from '@/lib/replay-framework/insights/managerReplayInsight'

// ── Context + result ───────────────────────────────────────────────────────────

/** Minimal request context — testable without NextRequest, same shape as `IntelligenceApiContext`. */
export interface ReplayInsightApiContext {
  headers: { get(key: string): string | null }
  searchParams: URLSearchParams
}

export interface ReplayInsightHandlerResult {
  status: number
  body: unknown
}

// ── Data provider (the IO seam) ─────────────────────────────────────────────────

/**
 * Read-only source of aggregate replay correlation metrics for one league.
 * Returns `null` ONLY when the underlying pipeline is unavailable (→ 503). A
 * league that simply has no replay corpus yet returns a valid, zero-trade
 * summary (→ 200 with an empty insight set), so callers can distinguish
 * "no data yet" from "endpoint broken".
 */
export interface ReplayInsightDataProvider {
  getReplayCorrelationSummary(leagueId: string): Promise<DecisionReplayCorrelationSummary | null>
}

/** Unwired stub — all requests return 503 until a route passes the live provider. Mirrors `stubDataProvider`. */
export const stubReplayInsightDataProvider: ReplayInsightDataProvider = {
  getReplayCorrelationSummary: async () => null,
}

/**
 * Live provider — the single IO boundary. Calls the read-only Phase 15/16
 * correlation directly (two `findMany`s, no writes). Always returns a summary
 * (possibly zero-trade); it never returns null under normal operation, so an
 * empty-corpus league surfaces as 200-with-empty-insights, not 503.
 */
export function createLiveReplayInsightDataProvider(): ReplayInsightDataProvider {
  return {
    getReplayCorrelationSummary: (leagueId: string) => computeDecisionReplayCorrelation([leagueId]),
  }
}

// ── Response envelope (mirrors IntelligenceApiResponse<T>) ───────────────────────

export interface ReplayInsightApiMeta {
  requestId: string
  tier: IntelligenceTier
  /** ISO 8601, from the insight set. */
  derivedAt: string
  /** Data-quality signal (0–100): share of considered trades that had usable subsequent lineup data. */
  completeness: number
  version: 'v1'
}

export interface ReplayInsightApiResponse {
  data: ManagerReplayInsightSetV1
  meta: ReplayInsightApiMeta
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** League-scoped replay insights read at the same scope as league intelligence — commissioner + platform tiers. */
const REQUIRED_SCOPE: IntelligenceApiScope = 'intelligence:league:read'

function hasScope(tier: IntelligenceTier, required: IntelligenceApiScope): boolean {
  return (TIER_SCOPE_MAP[tier] as IntelligenceApiScope[]).includes(required)
}

function errorResult(status: number, code: IntelligenceApiErrorCode, message: string, requestId: string): ReplayInsightHandlerResult {
  const body: IntelligenceApiError = { code, message, requestId }
  return { status, body }
}

function completenessFromSummary(summary: DecisionReplayCorrelationSummary): number {
  if (summary.totalTradesConsidered <= 0) return 0
  return Math.round((summary.totalTradesWithLineupData / summary.totalTradesConsidered) * 100)
}

// ── Handler ─────────────────────────────────────────────────────────────────────

/**
 * GET (future) /api/v1/intelligence/replay-insights?leagueId={id}
 *
 * Required scope: `intelligence:league:read`. Flow mirrors the intelligence
 * handlers exactly: gate → scope → param → provider → curated contract.
 *
 * `options.now` is injected purely to stamp `derivedAt` deterministically in
 * tests; it never influences any insight string (Phase 17 guarantee).
 */
export async function replayInsightHandler(
  ctx: ReplayInsightApiContext,
  dataProvider: ReplayInsightDataProvider,
  options: { now?: Date } = {},
): Promise<ReplayInsightHandlerResult> {
  const gate = checkIntelligenceGate(ctx.headers)
  if (!gate.ok) return { status: gate.status, body: gate.error }

  const { tier, requestId } = gate
  if (!hasScope(tier, REQUIRED_SCOPE)) {
    return errorResult(403, 'FORBIDDEN', 'API key does not have league intelligence scope.', requestId)
  }

  const leagueId = ctx.searchParams.get('leagueId')?.trim() ?? ''
  if (!leagueId) {
    return errorResult(400, 'INVALID_REQUEST', 'Missing required query parameter: leagueId.', requestId)
  }

  const summary = await dataProvider.getReplayCorrelationSummary(leagueId)
  if (!summary) {
    return errorResult(503, 'INTELLIGENCE_UNAVAILABLE', 'Replay insight data is not available.', requestId)
  }

  const insightSet = buildManagerReplayInsights(summary, { scope: 'league', now: options.now ?? new Date() })
  const meta: ReplayInsightApiMeta = {
    requestId,
    tier,
    derivedAt: insightSet.derivedAt,
    completeness: completenessFromSummary(summary),
    version: 'v1',
  }
  return { status: 200, body: { data: insightSet, meta } satisfies ReplayInsightApiResponse }
}
