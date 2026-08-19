import { describe, it, expect, vi } from 'vitest'
import {
  detectCommissionerIntelligenceIntent,
  formatCommissionerGroundingText,
  buildCommissionerGrounding,
  IntelligenceAccessError,
  INTELLIGENCE_FEATURES,
  type CommissionerGroundingSummary,
} from '@/lib/intelligence'

describe('detectCommissionerIntelligenceIntent', () => {
  it('matches commissioner / league-health questions', () => {
    for (const q of [
      'Why is my league inactive?',
      'Who needs commissioner attention?',
      'What happened recently in my league?',
      'What should I do to improve league health?',
      'Are there pending issues?',
      'Who has been most active?',
      'Give me a commissioner summary.',
    ]) {
      expect(detectCommissionerIntelligenceIntent(q), q).toBe(true)
    }
  })

  it('does NOT match ordinary fantasy questions', () => {
    for (const q of ['Should I start Patrick or Josh this week?', "What's my matchup projection?", 'Trade advice for my RB?', '']) {
      expect(detectCommissionerIntelligenceIntent(q), q).toBe(false)
    }
  })
})

const summaryFixture: CommissionerGroundingSummary = {
  totalEvents: 42,
  lastActivityAt: '2026-06-27T00:00:00.000Z',
  openTradeProposals: 1,
  counts: { trade: 3, waiver: 10, lineup: 20, draft: 1, scoring: 8, governance: 0, lifecycle: 0, other: 0 },
  health: { score: 72, status: 'healthy', activeManagers: 10, totalManagers: 12, daysSinceLastActivity: 1 },
  actionItems: [{ kind: 'pending_trades', severity: 'warning', message: '1 trade proposal(s) awaiting resolution.' }],
  recent: [{ type: 'transaction.trade.accepted', summary: 'Trade accepted', occurredAt: '2026-06-27T00:00:00.000Z' }],
}

describe('formatCommissionerGroundingText', () => {
  it('is privacy-safe and enforces cautious framing', () => {
    const text = formatCommissionerGroundingText(summaryFixture)
    expect(text).toMatch(/non-accusatory/i)
    expect(text).toMatch(/Do NOT allege collusion/i)
    expect(text).toContain('health score: 72/100 (healthy)')
    expect(text).toContain('active managers: 10/12')
    expect(text).toContain('Trade accepted')
    expect(text).not.toMatch(/payload|passwordHash|token/i)
  })
})

function makeService(over: Record<string, unknown> = {}) {
  return {
    getLeagueActivitySummary: vi.fn(async () => ({ leagueId: 'L', totalEvents: 42, lastActivityAt: '2026-06-27T00:00:00.000Z', openTradeProposals: 1, counts: summaryFixture.counts })),
    getLeagueHealthSnapshot: vi.fn(async () => ({ leagueId: 'L', healthScore: 72, status: 'healthy', activeManagers: 10, totalManagers: 12, daysSinceLastActivity: 1 })),
    getCommissionerActionItems: vi.fn(async () => [{ kind: 'inactive_managers', severity: 'action', message: '2 manager(s) inactive for over 14 days.', meta: { managerKeys: ['user-secret-123'] } }]),
    getLeagueAuditFeed: vi.fn(async () => ({ items: [{ eventId: 'e1', type: 'transaction.trade.accepted', summary: 'Trade accepted', occurredAt: '2026-06-27T00:00:00.000Z', actorType: 'user' }], nextCursor: null })),
    ...over,
  } as never
}

describe('buildCommissionerGrounding', () => {
  it('ok: builds text + structured summary, strips action-item meta (no user ids leak)', async () => {
    const g = await buildCommissionerGrounding({ service: makeService(), leagueId: 'L', principal: { userId: 'u1' } })
    expect(g.status).toBe('ok')
    expect(g.summary?.health.status).toBe('healthy')
    expect(g.summary?.actionItems[0]).toEqual({ kind: 'inactive_managers', severity: 'action', message: '2 manager(s) inactive for over 14 days.' })
    // privacy: the league-internal managerKey must NOT appear anywhere in the grounding
    expect(JSON.stringify(g)).not.toContain('user-secret-123')
    expect(g.text).not.toContain('user-secret-123')
  })

  it('empty: no recorded activity → empty grounding with safe next-steps', async () => {
    const g = await buildCommissionerGrounding({
      service: makeService({ getLeagueActivitySummary: vi.fn(async () => ({ leagueId: 'L', totalEvents: 0, lastActivityAt: null, openTradeProposals: 0, counts: {} })) }),
      leagueId: 'L',
    })
    expect(g.status).toBe('empty')
    expect(g.text).toMatch(/not enough recorded league activity/i)
  })

  it('restricted: feature-gate / access denial → restricted grounding, never throws', async () => {
    const g = await buildCommissionerGrounding({
      service: makeService({ getLeagueHealthSnapshot: vi.fn(async () => { throw new IntelligenceAccessError(INTELLIGENCE_FEATURES.HEALTH_SNAPSHOT, 'forbidden') }) }),
      leagueId: 'L',
    })
    expect(g.available).toBe(false)
    expect(g.status).toBe('restricted')
  })

  it('never throws on an unexpected error (degrades to empty)', async () => {
    const g = await buildCommissionerGrounding({
      service: makeService({ getLeagueActivitySummary: vi.fn(async () => { throw new Error('db down') }) }),
      leagueId: 'L',
    })
    expect(g.available).toBe(false)
    expect(g.status).toBe('empty')
  })
})
