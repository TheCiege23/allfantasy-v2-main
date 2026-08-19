/**
 * G15.5 — Commissioner Intelligence API handler cores.
 *
 * Pure-ish request handlers with INJECTED dependencies (session, access checks, the
 * G15.4 query service) so they unit-test without Next plumbing or a DB. Route files are
 * thin wrappers that supply real deps. The Intelligence Query Service is the ONLY source
 * of data — handlers never touch prisma/provider/feature tables directly.
 *
 * Permission model:
 *   - manager-readable (assertMember): activity, audit-feed, own manager snapshot
 *   - commissioner-only (assertCommissioner): health, action-items, another manager's snapshot
 * Feature-gate denial surfaces as 402 (upgrade_required) / 403 (deny).
 */
import { IntelligenceAccessError } from '../IntelligenceQueryService'
import type { IntelligenceQueryService } from '../IntelligenceQueryService'

export interface ApiResult {
  status: number
  body: unknown
}

export type AccessResult = { ok: true } | { ok: false; status: number }

export interface IntelligenceApiDeps {
  getUserId: () => Promise<string | null>
  assertMember: (leagueId: string, userId: string) => Promise<AccessResult>
  assertCommissioner: (leagueId: string, userId: string) => Promise<AccessResult>
  service: Pick<
    IntelligenceQueryService,
    'getLeagueActivitySummary' | 'getLeagueHealthSnapshot' | 'getManagerActivitySnapshot' | 'getCommissionerActionItems' | 'getLeagueAuditFeed'
  >
}

const ok = (data: unknown, meta?: Record<string, unknown>): ApiResult => ({ status: 200, body: meta ? { data, meta } : { data } })
const unauthorized = (): ApiResult => ({ status: 401, body: { error: 'unauthorized' } })
const accessDenied = (status: number): ApiResult => ({ status, body: { error: status === 404 ? 'not_found' : 'forbidden' } })

async function guard(run: () => Promise<ApiResult>): Promise<ApiResult> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof IntelligenceAccessError) {
      const status = err.decision === 'upgrade_required' ? 402 : 403
      return { status, body: { error: 'feature_unavailable', feature: err.feature, decision: err.decision } }
    }
    return { status: 500, body: { error: 'internal_error' } }
  }
}

async function requireMember(leagueId: string, deps: IntelligenceApiDeps): Promise<{ userId: string } | ApiResult> {
  const userId = await deps.getUserId()
  if (!userId) return unauthorized()
  const access = await deps.assertMember(leagueId, userId)
  if (!access.ok) return accessDenied(access.status)
  return { userId }
}

async function requireCommissioner(leagueId: string, deps: IntelligenceApiDeps): Promise<{ userId: string } | ApiResult> {
  const userId = await deps.getUserId()
  if (!userId) return unauthorized()
  const access = await deps.assertCommissioner(leagueId, userId)
  if (!access.ok) return accessDenied(access.status)
  return { userId }
}

const isResult = (v: { userId: string } | ApiResult): v is ApiResult => 'status' in v

// ── Manager-readable ─────────────────────────────────────────────────────────

export async function activityHandler(leagueId: string, deps: IntelligenceApiDeps): Promise<ApiResult> {
  const m = await requireMember(leagueId, deps)
  if (isResult(m)) return m
  return guard(async () => ok(await deps.service.getLeagueActivitySummary(leagueId, { userId: m.userId })))
}

export async function auditFeedHandler(
  leagueId: string,
  deps: IntelligenceApiDeps,
  query: { limit?: number; cursor?: string } = {},
): Promise<ApiResult> {
  const m = await requireMember(leagueId, deps)
  if (isResult(m)) return m
  return guard(async () => {
    const page = await deps.service.getLeagueAuditFeed(leagueId, query, { userId: m.userId })
    return ok(page.items, { nextCursor: page.nextCursor })
  })
}

/** Self-or-commissioner: a member may read their own snapshot; others require commissioner. */
export async function managerHandler(leagueId: string, managerId: string, deps: IntelligenceApiDeps): Promise<ApiResult> {
  const userId = await deps.getUserId()
  if (!userId) return unauthorized()
  const member = await deps.assertMember(leagueId, userId)
  if (!member.ok) return accessDenied(member.status)
  if (managerId !== userId) {
    const comm = await deps.assertCommissioner(leagueId, userId)
    if (!comm.ok) return accessDenied(comm.status)
  }
  return guard(async () => ok(await deps.service.getManagerActivitySnapshot(leagueId, managerId, { userId })))
}

// ── Commissioner-only ────────────────────────────────────────────────────────

export async function healthHandler(leagueId: string, deps: IntelligenceApiDeps): Promise<ApiResult> {
  const c = await requireCommissioner(leagueId, deps)
  if (isResult(c)) return c
  return guard(async () => ok(await deps.service.getLeagueHealthSnapshot(leagueId, { userId: c.userId })))
}

export async function actionItemsHandler(leagueId: string, deps: IntelligenceApiDeps): Promise<ApiResult> {
  const c = await requireCommissioner(leagueId, deps)
  if (isResult(c)) return c
  return guard(async () => ok(await deps.service.getCommissionerActionItems(leagueId, { userId: c.userId })))
}

/** Parse + clamp audit-feed query params from a URLSearchParams. */
export function parseAuditFeedQuery(params: URLSearchParams): { limit?: number; cursor?: string } {
  const out: { limit?: number; cursor?: string } = {}
  const rawLimit = params.get('limit')
  if (rawLimit != null) {
    const n = Number.parseInt(rawLimit, 10)
    if (Number.isFinite(n) && n > 0) out.limit = Math.min(n, 100)
  }
  const cursor = params.get('cursor')
  if (cursor) out.cursor = cursor
  return out
}
