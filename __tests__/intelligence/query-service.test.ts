import { describe, it, expect } from 'vitest'
import { computeHealth, deriveActionItems } from '@/lib/intelligence'

const now = new Date('2026-06-27T12:00:00.000Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)

describe('computeHealth', () => {
  it('returns unknown for a league with no events', () => {
    expect(computeHealth({ leagueId: 'L', lastActivityAt: null, totalEvents: 0, openTradeProposals: 0 }, [], now)).toMatchObject({
      healthScore: 0,
      status: 'unknown',
      activeManagers: 0,
    })
  })

  it('is healthy with recent activity + active managers', () => {
    const managers = [{ managerKey: 'a', lastActiveAt: daysAgo(1) }, { managerKey: 'b', lastActiveAt: daysAgo(2) }]
    const r = computeHealth({ leagueId: 'L', lastActivityAt: daysAgo(1), totalEvents: 50, openTradeProposals: 0 }, managers, now)
    expect(r.activeManagers).toBe(2)
    expect(r.status).toBe('healthy')
    expect(r.healthScore).toBeGreaterThanOrEqual(70)
  })

  it('is stale with old activity + inactive managers', () => {
    const managers = [{ managerKey: 'a', lastActiveAt: daysAgo(40) }]
    const r = computeHealth({ leagueId: 'L', lastActivityAt: daysAgo(30), totalEvents: 10, openTradeProposals: 0 }, managers, now)
    expect(r.activeManagers).toBe(0)
    expect(r.status).toBe('stale')
  })
})

describe('deriveActionItems', () => {
  it('reports no_activity for an empty league', () => {
    const items = deriveActionItems(null, [], now)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('no_activity')
  })

  it('flags pending trades, stale league, and inactive managers', () => {
    const league = { leagueId: 'L', lastActivityAt: daysAgo(10), totalEvents: 20, openTradeProposals: 2 }
    const managers = [{ managerKey: 'a', lastActiveAt: daysAgo(1) }, { managerKey: 'b', lastActiveAt: daysAgo(30) }]
    const items = deriveActionItems(league, managers, now)
    const kinds = items.map((i) => i.kind)
    expect(kinds).toContain('pending_trades')
    expect(kinds).toContain('stale_league') // 10 > 7
    expect(kinds).toContain('inactive_managers') // b inactive 30 > 14
    const pending = items.find((i) => i.kind === 'pending_trades')!
    expect(pending.severity).toBe('warning')
    expect(pending.meta?.openTradeProposals).toBe(2)
  })

  it('is quiet for a healthy, active league', () => {
    const league = { leagueId: 'L', lastActivityAt: daysAgo(1), totalEvents: 20, openTradeProposals: 0 }
    const managers = [{ managerKey: 'a', lastActiveAt: daysAgo(1) }]
    expect(deriveActionItems(league, managers, now)).toHaveLength(0)
  })
})
