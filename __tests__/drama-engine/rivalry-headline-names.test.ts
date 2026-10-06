/**
 * Rivalry storylines name the teams (2026-10-05).
 *
 * The RIVALRY_CLASH headline was built from `managerAId`/`managerBId` directly, and the rivalry
 * engine keys a pair by the team's externalId (a roster number) or by its owner name. Measured
 * across 40 commissioner leagues: 146 of 587 Commissioner OS cards read like "13 vs 9: Emerging
 * rivalry". Every other headline in the detector names the team; this one now does too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  listRivalries: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    seasonResult: { findMany: vi.fn().mockResolvedValue([]) },
    matchupFact: { findMany: vi.fn().mockResolvedValue([]) },
    seasonSimulationResult: { findMany: vi.fn().mockResolvedValue([]) },
    dynastyProjection: { findMany: vi.fn().mockResolvedValue([]) },
    leagueDynastySeason: { findMany: vi.fn().mockResolvedValue([]) },
    leagueTradeHistory: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/rivalry-engine/RivalryQueryService', () => ({ listRivalries: mocks.listRivalries }))
vi.mock('@/lib/psychological-profiles/ManagerBehaviorQueryService', () => ({
  listProfilesByLeague: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/league-intelligence-graph/GraphQueryService', () => ({
  getDramaCentralTeams: vi.fn().mockResolvedValue([]),
}))

import { detectDramaEvents } from '@/lib/drama-engine/DramaEventDetector'

const rivalry = (managerAId: string, managerBId: string, rivalryTier = 'Heated') => ({
  id: `r-${managerAId}-${managerBId}`,
  managerAId,
  managerBId,
  rivalryTier,
  rivalryScore: 44,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leagueFindUnique.mockResolvedValue({
    id: 'league-1',
    season: 2026,
    platform: 'espn',
    platformLeagueId: null,
    teams: [
      { id: 'lt-13', externalId: '13', teamName: 'Hoovi', ownerName: 'hoovi_owner' },
      { id: 'lt-9', externalId: '9', teamName: 'rexy40', ownerName: 'rexy_owner' },
      { id: 'lt-2', externalId: '2', teamName: '  ', ownerName: 'nameless_owner' },
    ],
  })
})

async function rivalryHeadlines() {
  const events = await detectDramaEvents({ leagueId: 'league-1', sport: 'NFL', season: 2026 })
  return events.filter((e) => e.dramaType === 'RIVALRY_CLASH').map((e) => e.headline)
}

describe('rivalry storyline headlines', () => {
  it('🛑 name both teams when the pair is keyed by roster number', async () => {
    mocks.listRivalries.mockResolvedValue([rivalry('13', '9')])
    expect(await rivalryHeadlines()).toEqual(['Hoovi vs rexy40: Heated rivalry'])
  })

  it('name the teams when the pair is keyed by owner name', async () => {
    mocks.listRivalries.mockResolvedValue([rivalry('hoovi_owner', 'rexy_owner', 'Emerging')])
    expect(await rivalryHeadlines()).toEqual(['Hoovi vs rexy40: Emerging rivalry'])
  })

  it('fall back to the owner when a team has no name, and never print a bare roster number', async () => {
    mocks.listRivalries.mockResolvedValue([rivalry('2', '42'), rivalry('13', 'someone_unlisted')])
    const headlines = await rivalryHeadlines()
    expect(headlines).toEqual(['nameless_owner vs Team 42: Heated rivalry', 'Hoovi vs someone_unlisted: Heated rivalry'])
    for (const h of headlines) expect(h).not.toMatch(/^\d+ vs |vs \d+:/)
  })
})
