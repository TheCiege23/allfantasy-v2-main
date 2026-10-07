/**
 * Storylines name an open slot the way the Commissioner Hub does (2026-10-07).
 *
 * Every team an importer wrote as "Unknown" is an open slot whose owner name is "Unknown" too. The
 * hub names those "Team 9" (`teamDisplayName`), but the detector read `team.teamName` raw, so the
 * same page carried "Collapse warning: Unknown has dropped 4 straight" — 7 headlines on production,
 * one of them "Unknown vs Unknown: Emerging rivalry".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  listRivalries: vi.fn(),
  matchupFacts: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    seasonResult: { findMany: vi.fn().mockResolvedValue([]) },
    matchupFact: { findMany: mocks.matchupFacts },
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

import { detectDramaEvents, rivalSideNamer } from '@/lib/drama-engine/DramaEventDetector'
import { commissionerOsText } from '@/lib/core-app/commissionerOsText'

const openSlot = (ext: string) => ({ id: `lt-${ext}`, externalId: ext, teamName: 'Unknown', ownerName: 'Unknown' })
const TEAMS = [
  { id: 'lt-13', externalId: '13', teamName: 'Hoovi', ownerName: 'hoovi_owner' },
  openSlot('9'),
  openSlot('10'),
]

// Week 3 first (the detector reads newest first): Hoovi beats slot 9 three weeks running.
const LOSING_RUN = [3, 2, 1].map((w) => ({
  id: `m-${w}`,
  weekOrPeriod: w,
  teamA: '13',
  teamB: '9',
  scoreA: 110,
  scoreB: 100,
  winnerTeamId: '13',
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leagueFindUnique.mockResolvedValue({ id: 'league-1', season: 2026, platform: 'sleeper', platformLeagueId: null, teams: TEAMS })
  mocks.listRivalries.mockResolvedValue([])
  mocks.matchupFacts.mockResolvedValue([])
})

async function headlines(type: string) {
  const events = await detectDramaEvents({ leagueId: 'league-1', sport: 'NFL', season: 2026 })
  return events.filter((e) => e.dramaType === type).map((e) => e.headline)
}

describe('storyline headlines for a team with no name', () => {
  it('🛑 a streak names the open slot "Team 9", never "Unknown"', async () => {
    mocks.matchupFacts.mockResolvedValue(LOSING_RUN)
    expect(await headlines('LOSING_STREAK')).toEqual(['Collapse warning: Team 9 has dropped 3 straight'])
    expect(await headlines('WIN_STREAK')).toEqual(['Hoovi is on a 3-game heater'])
  })

  it('a rivalry between two open slots reads "Team 10 vs Team 9", not "Unknown vs Unknown"', async () => {
    mocks.listRivalries.mockResolvedValue([
      { id: 'r-1', managerAId: '10', managerBId: '9', rivalryTier: 'Emerging', rivalryScore: 27 },
    ])
    expect(await headlines('RIVALRY_CLASH')).toEqual(['Team 10 vs Team 9: Emerging rivalry'])
  })

  it('leaves a stand-in side unresolved, so the rename pass still waits for a real name', () => {
    const side = rivalSideNamer(TEAMS)
    expect(side('9')).toEqual({ name: 'Team 9', resolved: false })
    expect(side('13')).toEqual({ name: 'Hoovi', resolved: true })
    // A pair keyed by a real owner name still resolves to that team.
    expect(side('hoovi_owner')).toEqual({ name: 'Hoovi', resolved: true })
  })
})

describe('the Spanish rendering of those headlines', () => {
  it('translates the stand-in, which is ours, and nothing that is the user’s', () => {
    expect(commissionerOsText('Collapse warning: Team 9 has dropped 4 straight', 'es')).toBe('Alerta de derrumbe: Equipo 9 ha perdido 4 seguidos')
    expect(commissionerOsText('Team 3 is on a 3-game heater', 'es')).toBe('Equipo 3 lleva una racha de 3 victorias')
    expect(commissionerOsText('Team 10 vs Team 9: Emerging rivalry', 'es')).toMatch(/^Equipo 10 vs Equipo 9: rivalidad \S/)
    expect(commissionerOsText('Major upset in week 4: Hoovi vs Team 9', 'es')).toBe('Gran sorpresa en la semana 4: Hoovi vs Equipo 9')
    // A real team NAMED "Team Awesome" is the user's, and "Team 1234" is not a slot.
    expect(commissionerOsText('Team Awesome is on a 3-game heater', 'es')).toBe('Team Awesome lleva una racha de 3 victorias')
    expect(commissionerOsText('Team 1234 is on a 3-game heater', 'es')).toBe('Team 1234 lleva una racha de 3 victorias')
    // English is untouched.
    expect(commissionerOsText('Collapse warning: Team 9 has dropped 4 straight', 'en')).toBe('Collapse warning: Team 9 has dropped 4 straight')
  })
})
