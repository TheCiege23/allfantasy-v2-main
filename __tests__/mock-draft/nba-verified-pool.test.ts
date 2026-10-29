// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ pool: vi.fn(), eligibility: vi.fn(), market: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: mocks.pool, getPlayerPoolForSport: mocks.pool }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ loadLatestAveragedAdpRowsFromDb: mocks.market }))
vi.mock('@/lib/draft-room/nbaSurvivorRosterEligibility', async original => ({ ...await original<typeof import('@/lib/draft-room/nbaSurvivorRosterEligibility')>(), loadNbaSurvivorRosterEligibility: mocks.eligibility }))
import { buildNbaRosterEligibility } from '@/lib/draft-room/nbaSurvivorRosterEligibility'
import { loadSportAwareDraftPlayerPool } from '@/lib/mock-draft/sport-player-pool'

const poolRow = (name: string, id: string, position = 'C') => ({ full_name: name, external_source_id: id, player_id: `row-${id}`, position, team_abbreviation: 'DEN', age: 28 })
const evidence = (name: string, id: string, status: string, source = 'rolling_insights') => ({ name, externalId: id, status, source, team: 'DEN', fetchedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.pool.mockResolvedValue([
    ...Array.from({length: 320}, (_, index) => poolRow(`Historical A ${index}`, String(1000+index))),
    poolRow('Owner Example', '900', 'OWNER'), poolRow('A.J. Hammons', '563'),
    poolRow('Nikola Jokic', '114'), poolRow('Nikola Jokic', '999'), poolRow('Bam Adebayo', '115'),
  ])
  mocks.eligibility.mockResolvedValue(buildNbaRosterEligibility([
    evidence('Nikola Jokic', '114', 'ACT'), evidence('Bam Adebayo', '115', 'INACT'),
    evidence('Bam Adebayo', 'tsdb-bam', 'Active', 'thesportsdb'),
    evidence('Owner Example', '900', 'ACT'), evidence('A.J. Hammons', '563', 'INACT'),
  ], 1))
  mocks.market.mockResolvedValue([{ name: 'Nikola Jokic', position: 'C', team: 'DEN', adp: 1.34 }, { name: 'Bam Adebayo', position: 'C', team: 'MIA', adp: 17.2 }])
})
describe('NBA mock pool uses verified athletes before display limits', () => {
  it('keeps Jokic beyond the former alphabetical cutoff and excludes staff, retired and unverified ids', async () => {
    const players = await loadSportAwareDraftPlayerPool({ sport: 'NBA', leagueId: 'native-nba', limit: 2 })
    expect(mocks.pool).toHaveBeenCalledWith('native-nba', 'NBA', {limit: 5000})
    expect(players.map(p=>p.name)).toEqual(['Nikola Jokic', 'Bam Adebayo'])
    expect(players[0]).toMatchObject({playerId:'114', adp:1.34, value:null})
    expect(players[1].playerId).toBe('115')
    expect(mocks.market).toHaveBeenCalledWith('NBA', 'redraft', false, {season:new Date().getUTCFullYear(),scoring:'Points'}, {allowLiveImport:false})
  })
  it('leaves missing ADP and projection values unknown', async () => {
    mocks.market.mockResolvedValue([])
    const players = await loadSportAwareDraftPlayerPool({sport:'NBA',limit:1000})
    expect(players).toHaveLength(2)
    expect(players.every(p=>p.adp===null && p.value===null)).toBe(true)
  })
  it('does not fall back to historical profiles when current roster evidence is unavailable', async () => {
    mocks.eligibility.mockResolvedValue({ready:false,reason:'Current NBA roster unavailable'})
    await expect(loadSportAwareDraftPlayerPool({sport:'NBA',limit:1000})).rejects.toThrow('Current NBA roster unavailable')
  })
  it('keeps the existing non-NBA adapter contract', async () => {
    mocks.pool.mockResolvedValue([poolRow('Example QB','7','QB')])
    const [player]=await loadSportAwareDraftPlayerPool({sport:'NFL',limit:300})
    expect(mocks.pool).toHaveBeenCalledWith('NFL',{limit:300})
    expect(player.adp).toBe(1);expect(mocks.eligibility).not.toHaveBeenCalled();expect(mocks.market).not.toHaveBeenCalled()
  })
})
