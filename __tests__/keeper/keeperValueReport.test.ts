import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: vi.fn(),
  players: vi.fn(),
  gate: vi.fn(),
  ranks: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: m.league }, redraftRosterPlayer: { findMany: m.players } } }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class { evaluateUserFeatureAccess = m.gate } }))
vi.mock('@/lib/keeper/keeperMarketValues', () => ({ loadKeeperMarketRanks: m.ranks }))

import { keeperValueReport } from '@/lib/keeper/keeperValueReport'

const rows = [
  { playerId: 'p1', rosterId: 'R', projectedCostRound: 9 },
  { playerId: 'p2', rosterId: 'R', projectedCostRound: 3 },
  { playerId: 'p3', rosterId: 'R', projectedCostRound: 5 },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.league.mockResolvedValue({ userId: 'commish', sport: 'NFL', leagueSize: 12, scoringPresetId: null, settings: {} })
  m.gate.mockResolvedValue({ allowed: true })
  m.players.mockResolvedValue([
    { rosterId: 'R', playerId: 'p1', playerName: 'Star', position: 'WR' },
    { rosterId: 'R', playerId: 'p2', playerName: 'Bust', position: 'RB' },
    { rosterId: 'R', playerId: 'p3', playerName: 'Unknown', position: 'TE' },
  ])
  m.ranks.mockResolvedValue((p: { name?: string | null }) => (p.name === 'Star' ? 10 : p.name === 'Bust' ? 80 : null))
})

describe('keeper value report', () => {
  it('prices every candidate it can, against his cost, and leaves out the ones it cannot', async () => {
    expect(await keeperValueReport('L', rows)).toEqual({
      available: true,
      values: { p1: { marketRank: 10, pickSlot: 102, surplus: 92 }, p2: { marketRank: 80, pickSlot: 30, surplus: -50 } },
    })
  })
  it("is the league commissioner's AF Commissioner feature, shared with every manager", async () => {
    m.gate.mockResolvedValue({ allowed: false })
    expect(await keeperValueReport('L', rows)).toEqual({ available: false, reason: 'not_entitled' })
    expect(m.gate).toHaveBeenCalledWith('commish', 'commissioner_automation')
    expect(m.ranks).not.toHaveBeenCalled()
  })
  it('says so when the league has no market values (FantasyCalc covers NFL only)', async () => {
    m.ranks.mockResolvedValue(null)
    expect(await keeperValueReport('L', rows)).toEqual({ available: false, reason: 'no_market_values' })
  })
})
