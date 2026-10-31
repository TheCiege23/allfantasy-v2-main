/** A tanking lottery penalty lowers the team's odds in the preview AND the draw (phase 6, 2026-10-27). */
import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, completed: [] as Array<{ createdAt: Date }> }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ settings: m.settings })) },
    draftSession: { findMany: vi.fn(async () => m.completed) },
  },
}))
vi.mock('@/lib/draft-lottery/standingsForLottery', async (orig) => {
  const real = await orig<typeof import('@/lib/draft-lottery/standingsForLottery')>()
  const rows = [1, 2, 3, 4].map((rank) => ({ rosterId: `r${rank}`, displayName: `T${rank}`, teamIndex: rank, rank, wins: 5 - rank, losses: rank, ties: 0, pointsFor: 100 }))
  return { ...real, getStandingsForLottery: vi.fn(async () => rows.map((r) => ({ ...r }))) }
})

import { previewLotteryOdds, runWeightedLottery } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import { DEFAULT_WEIGHTED_LOTTERY_CONFIG, type WeightedLotteryConfig } from '@/lib/draft-lottery/types'

const config: WeightedLotteryConfig = { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, enabled: true, eligibilityMode: 'all_teams', lotteryTeamCount: 4, lotteryPickCount: 4 }
const odds = async () => Object.fromEntries((await previewLotteryOdds('L', config))!.eligible.map((e) => [e.rosterId, e.oddsPercent]))

describe('lottery odds with a tanking penalty', () => {
  it('halves the team’s weight and re-shares the odds over the league', async () => {
    m.settings = {}
    const before = await odds()
    m.settings = { integrity_tanking_lottery_penalties: [{ rosterId: 'r4', cutPct: 50, at: '2026-12-01T00:00:00.000Z', flagId: 'f' }] }
    const after = await odds()
    expect(after.r4!).toBeLessThan(before.r4!)
    expect(after.r1!).toBeGreaterThan(before.r1!)
    expect(Object.values(after).reduce((a, b) => a + b, 0)).toBeCloseTo(100)
  })

  it('a full cut keeps the team out of every lottery pick', async () => {
    m.settings = { integrity_tanking_lottery_penalties: [{ rosterId: 'r4', cutPct: 100, at: '2026-12-01T00:00:00.000Z', flagId: 'f' }] }
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const r = await runWeightedLottery('L', config, seed)
      expect(r!.lotteryDraws.map((d) => d.rosterId)).not.toContain('r4')
      expect(r!.oddsSnapshot.map((o) => o.rosterId)).not.toContain('r4')
    }
  })

  it('stops counting once a draft created after it is complete', async () => {
    m.settings = {}
    const before = await odds()
    m.settings = { integrity_tanking_lottery_penalties: [{ rosterId: 'r4', cutPct: 50, at: '2026-12-01T00:00:00.000Z', flagId: 'f' }] }
    m.completed = [{ createdAt: new Date('2027-01-10') }]
    expect(await odds()).toEqual(before)
  })
})
