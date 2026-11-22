import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The lottery's fallback order — the picks the draw does not assign (lib/draft-lottery/WeightedDraftLotteryEngine.ts
 * `buildFullSlotOrder`).
 *
 * 🛑 `reverse_max_pf` WAS COERCED TO `reverse_standings`, AND IT IS THE DEFAULT. The fixture here is built so the two
 * orders DISAGREE: rank 5 scored less than rank 6, so by record rank 6 picks first and by Max PF rank 5 does. Every
 * earlier fixture had points for falling with rank, where the two orders are the same list and the coercion was invisible.
 */

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique } } }))

import { buildFullSlotOrder, runWeightedLottery } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import { DEFAULT_WEIGHTED_LOTTERY_CONFIG, type WeightedLotteryConfig } from '@/lib/draft-lottery/types'

/**
 * Points for by rank: rank 5 (a better record) scored LESS than rank 6, and rank 2 — a playoff team — scored less
 * than every non-playoff team left after the draw, so only the playoff line keeps it behind them.
 */
const PF: Record<number, number> = { 1: 1900, 2: 1200, 3: 1700, 4: 1600, 5: 1300, 6: 1450, 7: 1400, 8: 1350, 9: 1250, 10: 1200, 11: 1150, 12: 1100 }

const LEAGUE = {
  leagueSize: 12,
  settings: { playoff_team_count: 4 },
  rosters: Array.from({ length: 12 }, (_, i) => ({ id: `r${String(i + 1).padStart(2, '0')}`, platformUserId: null })),
  teams: Array.from({ length: 12 }, (_, i) => {
    const rank = i + 1
    return {
      id: `t${String(rank).padStart(2, '0')}`, externalId: `r${String(rank).padStart(2, '0')}`, claimedByUserId: null, platformUserId: null,
      ownerName: `Owner ${rank}`, teamName: `Rank ${rank}`, wins: 13 - rank, losses: rank - 1, ties: 0, pointsFor: PF[rank], currentRank: rank,
    }
  }),
}
const rankOf = (rosterId: string) => Number(rosterId.slice(1))
const CONFIG: WeightedLotteryConfig = { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, enabled: true }

beforeEach(() => {
  vi.clearAllMocks()
  findUnique.mockResolvedValue(LEAGUE)
})

describe('runWeightedLottery: the picks the draw does not assign', () => {
  it('the default (reverse_max_pf): non-playoff teams by lowest Max PF, then the playoff teams by finish', async () => {
    expect(CONFIG.fallbackOrder).toBe('reverse_max_pf')
    const result = await runWeightedLottery('L1', { ...CONFIG, randomSeed: 's' }, 's')
    // The six worst (7–12) are drawn; 5 and 6 sit outside the playoffs, 1–4 made them.
    expect(result!.fallbackOrder.map((s) => rankOf(s.rosterId))).toEqual([5, 6, 4, 3, 2, 1])
    expect(result!.configSnapshot.fallbackOrder).toBe('reverse_max_pf')
    expect(new Set(result!.slotOrder.map((s) => s.rosterId)).size).toBe(12)
  })

  it('reverse_standings: worst finish first, whatever anyone scored', async () => {
    const result = await runWeightedLottery('L1', { ...CONFIG, fallbackOrder: 'reverse_standings', randomSeed: 's' }, 's')
    expect(result!.fallbackOrder.map((s) => rankOf(s.rosterId))).toEqual([6, 5, 4, 3, 2, 1])
  })

  it('manual reads as reverse standings: there is no commissioner order to read', async () => {
    const result = await runWeightedLottery('L1', { ...CONFIG, fallbackOrder: 'manual', randomSeed: 's' }, 's')
    expect(result!.fallbackOrder.map((s) => rankOf(s.rosterId))).toEqual([6, 5, 4, 3, 2, 1])
  })
})

describe('buildFullSlotOrder', () => {
  // Best-first, as applyTiebreak leaves it.
  const standings = [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => ({ rosterId: `r${rank}`, displayName: `Rank ${rank}`, rank, maxPf: PF[rank] }))
  const draws = [{ pickSlot: 1, rosterId: 'r8', displayName: 'Rank 8', originalOrder: 1 }]
  const order = (fallback: 'reverse_max_pf' | 'reverse_standings', playoffTeams: number, rows = standings) =>
    buildFullSlotOrder(draws, rows, new Set(['r8']), fallback, playoffTeams).map((s) => `${s.slot}:${rankOf(s.rosterId)}`)

  it('🛑 a playoff team never jumps a non-playoff team, however little it scored', () => {
    // Rank 2 scored less than every team here; it made the playoffs, so it still picks after 5–7.
    expect(order('reverse_max_pf', 4)).toEqual(['1:8', '2:5', '3:7', '4:6', '5:4', '6:3', '7:2', '8:1'])
  })

  it('no playoff line: everyone left is ordered by Max PF', () => {
    expect(order('reverse_max_pf', 0)).toEqual(['1:8', '2:2', '3:5', '4:7', '5:6', '6:4', '7:3', '8:1'])
  })

  it('a Max PF tie goes to the worse finish', () => {
    const tied = standings.map((r) => (r.rank === 5 || r.rank === 6 ? { ...r, maxPf: 1000 } : r))
    expect(order('reverse_max_pf', 4, tied)).toEqual(['1:8', '2:6', '3:5', '4:7', '5:4', '6:3', '7:2', '8:1'])
  })

  it('reverse_standings is unchanged', () => {
    expect(order('reverse_standings', 4)).toEqual(['1:8', '2:7', '3:6', '4:5', '5:4', '6:3', '7:2', '8:1'])
  })
})
