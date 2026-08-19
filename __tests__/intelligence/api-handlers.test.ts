import { describe, it, expect, vi } from 'vitest'
import {
  activityHandler,
  healthHandler,
  actionItemsHandler,
  auditFeedHandler,
  managerHandler,
  parseAuditFeedQuery,
  type IntelligenceApiDeps,
} from '@/lib/intelligence/api/handlers'
import { IntelligenceAccessError, INTELLIGENCE_FEATURES } from '@/lib/intelligence'

function makeDeps(over: Partial<IntelligenceApiDeps> = {}): IntelligenceApiDeps {
  const service = {
    getLeagueActivitySummary: vi.fn(async () => ({ leagueId: 'L', totalEvents: 5, counts: { trade: 1 } })),
    getLeagueHealthSnapshot: vi.fn(async () => ({ leagueId: 'L', status: 'healthy', healthScore: 80 })),
    getManagerActivitySnapshot: vi.fn(async () => ({ leagueId: 'L', managerKey: 'u1', totalActions: 3 })),
    getCommissionerActionItems: vi.fn(async () => [{ kind: 'pending_trades', severity: 'warning', message: 'x' }]),
    getLeagueAuditFeed: vi.fn(async () => ({ items: [{ eventId: 'e1', type: 't', summary: 's' }], nextCursor: 'cur1' })),
  }
  return {
    getUserId: vi.fn(async () => 'u1'),
    assertMember: vi.fn(async () => ({ ok: true as const })),
    assertCommissioner: vi.fn(async () => ({ ok: true as const })),
    service: service as never,
    ...over,
  }
}

describe('intelligence API handlers — auth & access', () => {
  it('activity: 200 for a member', async () => {
    const r = await activityHandler('L', makeDeps())
    expect(r.status).toBe(200)
    expect((r.body as { data: { totalEvents: number } }).data.totalEvents).toBe(5)
  })

  it('activity: 401 when unauthenticated', async () => {
    const r = await activityHandler('L', makeDeps({ getUserId: vi.fn(async () => null) }))
    expect(r.status).toBe(401)
  })

  it('activity: 404 when league not found, 403 when not a member', async () => {
    expect((await activityHandler('L', makeDeps({ assertMember: vi.fn(async () => ({ ok: false, status: 404 })) }))).status).toBe(404)
    expect((await activityHandler('L', makeDeps({ assertMember: vi.fn(async () => ({ ok: false, status: 403 })) }))).status).toBe(403)
  })

  it('health: commissioner-only (200 commissioner, 403 non-commissioner)', async () => {
    expect((await healthHandler('L', makeDeps())).status).toBe(200)
    expect((await healthHandler('L', makeDeps({ assertCommissioner: vi.fn(async () => ({ ok: false, status: 403 })) }))).status).toBe(403)
  })

  it('action-items: commissioner-only', async () => {
    expect((await actionItemsHandler('L', makeDeps())).status).toBe(200)
    expect((await actionItemsHandler('L', makeDeps({ assertCommissioner: vi.fn(async () => ({ ok: false, status: 403 })) }))).status).toBe(403)
  })

  it('manager: self is readable without commissioner; another manager requires commissioner', async () => {
    // self (managerId === userId)
    const self = await managerHandler('L', 'u1', makeDeps({ assertCommissioner: vi.fn(async () => ({ ok: false, status: 403 })) }))
    expect(self.status).toBe(200)
    // other manager, not commissioner → 403
    const otherDenied = await managerHandler('L', 'u2', makeDeps({ assertCommissioner: vi.fn(async () => ({ ok: false, status: 403 })) }))
    expect(otherDenied.status).toBe(403)
    // other manager, commissioner → 200
    const otherOk = await managerHandler('L', 'u2', makeDeps())
    expect(otherOk.status).toBe(200)
  })
})

describe('intelligence API handlers — feature gate & empty state', () => {
  it('maps feature-gate deny → 403 and upgrade_required → 402', async () => {
    const denyDeps = makeDeps()
    ;(denyDeps.service.getLeagueActivitySummary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new IntelligenceAccessError(INTELLIGENCE_FEATURES.ACTIVITY_SUMMARY, 'deny'),
    )
    expect((await activityHandler('L', denyDeps)).status).toBe(403)

    const upgradeDeps = makeDeps()
    ;(upgradeDeps.service.getLeagueActivitySummary as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new IntelligenceAccessError(INTELLIGENCE_FEATURES.ACTIVITY_SUMMARY, 'upgrade_required'),
    )
    expect((await activityHandler('L', upgradeDeps)).status).toBe(402)
  })

  it('empty-state returns 200 with zeroed data (no special-casing)', async () => {
    const deps = makeDeps()
    ;(deps.service.getLeagueActivitySummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ leagueId: 'L', totalEvents: 0, counts: {} })
    const r = await activityHandler('L', deps)
    expect(r.status).toBe(200)
    expect((r.body as { data: { totalEvents: number } }).data.totalEvents).toBe(0)
  })
})

describe('intelligence API handlers — audit feed pagination', () => {
  it('returns items + nextCursor in meta', async () => {
    const r = await auditFeedHandler('L', makeDeps(), { limit: 1 })
    expect(r.status).toBe(200)
    const body = r.body as { data: unknown[]; meta: { nextCursor: string | null } }
    expect(body.data).toHaveLength(1)
    expect(body.meta.nextCursor).toBe('cur1')
  })

  it('parseAuditFeedQuery clamps + ignores invalid values', () => {
    expect(parseAuditFeedQuery(new URLSearchParams('limit=5&cursor=abc'))).toEqual({ limit: 5, cursor: 'abc' })
    expect(parseAuditFeedQuery(new URLSearchParams('limit=999'))).toEqual({ limit: 100 })
    expect(parseAuditFeedQuery(new URLSearchParams('limit=-3'))).toEqual({})
    expect(parseAuditFeedQuery(new URLSearchParams(''))).toEqual({})
  })
})
