// @vitest-environment node
/**
 * Defence in depth for Survivor's "forced bench": if the benched player sits in a starting slot anyway,
 * Survivor's weekly score (sumRedraftStartersFantasy) does not count his points that week. Survivor's own
 * total only — the base league's matchup score is a different path and never touched. A league that is
 * not Survivor never reads the reward ledger and scores exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: { sport: 'NFL', survivorMode: true, settings: {} } as Record<string, unknown>,
  score: vi.fn(),
  rewards: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    roster: { findFirst: vi.fn(async () => ({ redraftRosterId: 'rr-1' })) },
    redraftRoster: { findFirst: vi.fn(async () => ({ id: 'rr-1' })) },
  },
}))
vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: null } }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ scoreRosterForWeek: m.score }))
vi.mock('@/lib/survivor/survivorRewardEngine', () => ({ listSurvivorRewards: m.rewards }))
vi.mock('@/lib/survivor/survivorNbaWeeklyScoring', () => ({ scoreNbaSurvivorAllGamesRoster: vi.fn(), scoreNbaSurvivorOneGameRoster: vi.fn() }))

import { sumRedraftStartersFantasy } from '@/lib/survivor/gameStateMachine'

const season = { id: 's1', leagueId: 'L', season: 2026 }
const scored = (collect: boolean) => ({
  points: 100, starterCount: 2, scoredStarterCount: 2, missingPlayerIds: [], allFinal: true,
  ...(collect ? { playerPoints: [{ playerId: 'qb', points: 30.5, isStarter: true }, { playerId: 'rb', points: 69.5, isStarter: true }, { playerId: 'wr', points: 12, isStarter: false }] } : {}),
})

beforeEach(() => {
  vi.clearAllMocks()
  m.league = { sport: 'NFL', survivorMode: true, settings: {} }
  m.score.mockImplementation(async (args: { collectPlayerPoints?: boolean }) => scored(Boolean(args.collectPlayerPoints)))
  m.rewards.mockResolvedValue([{ spec: { type: 'forced_bench', chooserRosterId: 'af-9', targetRosterId: 'af-1', playerId: 'qb' }, status: 'applied', applyWeek: 5 }])
})

describe('Survivor weekly score with a forced bench', () => {
  it('a benched player who started anyway scores nothing for Survivor that week', async () => {
    expect(await sumRedraftStartersFantasy('af-1', 5, season)).toEqual({ pts: 69.5, allFinalized: true })
  })

  it('another week, or a bench-slot appearance, changes nothing', async () => {
    expect(await sumRedraftStartersFantasy('af-1', 6, season)).toEqual({ pts: 100, allFinalized: true })
    m.rewards.mockResolvedValue([{ spec: { type: 'forced_bench', chooserRosterId: 'af-9', targetRosterId: 'af-1', playerId: 'wr' }, status: 'applied', applyWeek: 5 }])
    expect(await sumRedraftStartersFantasy('af-1', 5, season)).toEqual({ pts: 100, allFinalized: true })
  })

  it('a league that is NOT Survivor never reads the ledger and scores as before', async () => {
    m.league = { sport: 'NFL', survivorMode: false, settings: {} }
    expect(await sumRedraftStartersFantasy('af-1', 5, season)).toEqual({ pts: 100, allFinalized: true })
    expect(m.rewards).not.toHaveBeenCalled()
    expect(m.score).toHaveBeenCalledWith(expect.not.objectContaining({ collectPlayerPoints: true }))
  })
})
