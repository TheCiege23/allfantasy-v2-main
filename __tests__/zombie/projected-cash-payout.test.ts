import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplayWeek } from '@/lib/zombie/beta2025CorrectionPlan'
import type { ZombieSettlementSnapshotV1 } from '@/lib/zombie/weeklySettlementSnapshot'

const h = vi.hoisted(() => ({ complete: true, prizes: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: async (read: (db: unknown) => unknown) => read({
  zombieLeague: { findUnique: async () => ({ id: 'z', leagueId: 'l', season: 2026, totalWeeks: 2, isPaid: true, ultimateSurvivorPot: false,
    paidConfig: { totalCollected: 100, commissionerFeeRate: 0, commissionerFeeCap: null, potIsLocked: true, ultimateSurvivorEnabled: false } }) },
  zombieExternalWeeklyPayout: { count: async () => h.prizes },
  zombieOperationsRecord: { findMany: async () => h.complete ? ['human', 'horde'].map(id => ({ id: `stints:l:${id}:2026`,
    payload: { stints: [{ userId: id, startWeek: 1, endWeek: 2 }] } })) : [] },
  zombieLeagueTeam: { findMany: async () => ['human', 'horde'].map(rosterId => ({ rosterId, pointsFor: 0 })) },
}) } }))

import { projectedZombieCashPayout } from '@/lib/zombie/projectedCashPayout'

const slate = (survives: boolean) => ({ week: 2,
  teams: [{ rosterId: 'human', status: survives ? 'Survivor' : 'Zombie' }, { rosterId: 'horde', status: 'Zombie' }],
  matches: [{ homeRosterId: 'human', awayRosterId: 'horde', homeScore: 20, awayScore: 10 }],
  totals: survives ? { human: 6, horde: 0 } : { human: 0, horde: 2 },
}) as unknown as ReplayWeek
const input = () => ({ leagueId: 'l', zombieLeagueId: 'z',
  opening: { owners: ['human', 'horde'].map(id => ({ rosterId: id, userId: id })) } as ZombieSettlementSnapshotV1,
  weeks: [{ before: slate(false), after: slate(true) }],
})

beforeEach(() => { h.complete = true; h.prizes = 0 })
describe('conditional projected Zombie cash awards', () => {
  it('uses the season accounting policy and conserves the funded pot', async () => {
    const result = await projectedZombieCashPayout(input())
    expect(result?.before.human).toBe(4900)
    expect(result?.after.human).toBe(10000)
    expect(Object.values(result!.before).reduce((sum, amount) => sum + amount, 0)).toBe(10000)
    expect(Object.values(result!.after).reduce((sum, amount) => sum + amount, 0)).toBe(10000)
  })
  it('withholds cash for undocumented ownership and unreconciled external prizes', async () => {
    h.complete = false
    expect(await projectedZombieCashPayout(input())).toBeNull()
    h.complete = true
    h.prizes = 1
    expect(await projectedZombieCashPayout(input())).toBeNull()
  })
})
