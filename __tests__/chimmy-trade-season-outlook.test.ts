import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ outlook: vi.fn() }))
vi.mock('@/lib/core-app/seasonOutlook', () => ({ getSeasonOutlook: h.outlook }))
import { tradeSeasonOutlook } from '@/lib/chimmy/tradeSeasonOutlook'
import type { ChimmyLeagueSnapshot } from '@/lib/chimmy/chimmy-league-snapshot'
import type { ReadyTradeScenario } from '@/lib/chimmy/tradeScenarioTypes'
const snapshot = () => ({ id: 'authorized', sport: 'NFL', season: 2026, lastSyncedAt: new Date() }) as ChimmyLeagueSnapshot
const scenario = { value: { grade: 'B' }, lineup: { delta: 1 }, playoffOdds: { available: false, reason: 'not computed' } } as ReadyTradeScenario
beforeEach(() => { vi.resetAllMocks(); h.outlook.mockResolvedValue({ leagues: [] }) })
afterEach(() => vi.useRealTimers())
describe('bounded trade season read', () => {
  it('reuses one authorized season read across multiple offers', async () => {
    const s = snapshot()
    const enrich = tradeSeasonOutlook(s, 'viewer')
    await Promise.all([enrich(scenario), enrich(scenario), enrich(scenario)])
    expect(h.outlook).toHaveBeenCalledTimes(1)
    expect(h.outlook).toHaveBeenCalledWith('viewer', [s], 'authorized')
  })
  it.each(['stale', 'unknown-sync', 'other-sport', 'incomplete-impact'])('does not read a season model for %s', async gap => {
    const s = snapshot()
    if (gap === 'stale') s.lastSyncedAt = new Date(Date.now() - 31 * 60_000)
    if (gap === 'unknown-sync') s.lastSyncedAt = null
    if (gap === 'other-sport') s.sport = 'NBA'
    const result = await tradeSeasonOutlook(s, 'viewer')(gap === 'incomplete-impact' ? { ...scenario, lineup: null } : scenario)
    expect(h.outlook).not.toHaveBeenCalled()
    expect(result.playoffOdds.available).toBe(false)
  })
  it('withholds odds when a season read fails without exposing private details', async () => {
    h.outlook.mockRejectedValue(new Error('private database URL'))
    const result = await tradeSeasonOutlook(snapshot(), 'viewer')(scenario)
    expect(result.playoffOdds.available).toBe(false)
    expect(result.playoffOdds.reason).not.toContain('private')
  })
  it('bounds a stalled model read to ten seconds', async () => {
    vi.useFakeTimers()
    h.outlook.mockReturnValue(new Promise(() => {}))
    const resultPromise = tradeSeasonOutlook(snapshot(), 'viewer')(scenario)
    await vi.advanceTimersByTimeAsync(10_001)
    const result = await resultPromise
    expect(result.playoffOdds.available).toBe(false)
  })
})
