import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ capture: vi.fn(), compare: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/zombie/weeklySettlementSnapshot', () => ({ capturePublicZombieForecastSnapshot: mocks.capture }))
vi.mock('@/lib/zombie/beta2025CorrectionPlan', () => ({ compareBeta2025TradeWeeks: mocks.compare }))

import { projectPublicZombieTradeSlate } from '@/lib/zombie/publicProjectedTradeSlate'

describe('public Zombie trade forecasts', () => {
  it('withholds the entire comparison when opening state is unavailable to public viewers', async () => {
    mocks.capture.mockResolvedValue(null)
    const roster = (id: string) => [{ id, positions: ['QB'], available: true as const, points: 12 }]
    const rosters = new Map([['home', roster('one')], ['away', roster('two')]])
    const applyItemTransfers = vi.fn()
    const result = await projectPublicZombieTradeSlate({
      leagueId: 'l', zombieLeagueId: 'z', openingWeek: 4, forecastWeek: 5,
      before: { schedule: [{ matchupId: 'm', homeRosterId: 'home', awayRosterId: 'away' }], rosters, seats: [['QB']] },
      afterRosters: rosters, affectedRosterIds: ['home', 'away'],
      settledAt: '2026-10-01T00:00:00Z', deadlineAt: '2026-10-02T00:00:00Z', applyItemTransfers,
    })
    expect(result).toBeNull()
    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(applyItemTransfers).not.toHaveBeenCalled()
    expect(mocks.compare).not.toHaveBeenCalled()
  })
})
