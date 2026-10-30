import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, read: vi.fn(), write: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: m.read, upsert: m.write } } }))
vi.mock('@/lib/workers/api-chain', () => ({ fetchWithChain: vi.fn() }))
import { getLiveScoresForSport } from '@/lib/sports-live-scores-service'
import { buildWeekKickoffMap, normalizeLockTeam } from '@/lib/redraft/lineupLock'

function event(sport: string, day: string, year: number) {
  const nba = sport === 'NBA'
  const team = (home: boolean) => ({ id: home ? '1' : '2', abbreviation: home ? 'ATL' : 'CLE',
    displayName: nba ? (home ? 'Atlanta Hawks' : 'Cleveland Cavaliers') : (home ? 'Atlanta Falcons' : 'Cleveland Browns') })
  return { id: `${sport}-real-shape`, date: day, season: { year }, competitions: [{
    competitors: [true, false].map(home => ({ homeAway: home ? 'home' : 'away', score: '0', team: team(home) })),
    status: { type: { name: 'STATUS_SCHEDULED', shortDetail: 'Scheduled', completed: false, state: 'pre' }, period: 0, displayClock: '0:00' },
  }] }
}
beforeEach(() => {
  vi.clearAllMocks(); m.rows = []
  m.read.mockImplementation(async () => m.rows)
  m.write.mockImplementation(async ({create, update}) => { m.rows = [{...create,...update}]; return m.rows[0] })
})
afterEach(() => vi.unstubAllGlobals())

describe('ESPN daily-game ingestion to real lock reader', () => {
  it('stores the starting season and provider full names while preserving cached scoreboard abbreviations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok:true,json:async()=>({events:[event('NBA','2026-10-30T00:00:00Z',2027)]})})))
    const result = await getLiveScoresForSport({sport:'NBA',forceRefresh:true,espnDates:['20261029']})
    expect(result.scores[0]).toMatchObject({homeTeam:'ATL',awayTeam:'CLE',season:2026})
    expect(m.rows[0]).toMatchObject({season:2026,homeTeam:'ATL',homeScore:null,awayScore:null,
      raw:{homeTeamFull:'Atlanta Hawks',awayTeamFull:'Cleveland Cavaliers'}})
    const kickoffs = await buildWeekKickoffMap({sportsGame:{findMany:m.read}} as never,{sport:'NBA',season:2026,week:2})
    expect(kickoffs.byTeamDay?.get(normalizeLockTeam('NBA','Atlanta Hawks'))?.get('2026-10-29')?.toISOString()).toBe('2026-10-30T00:00:00.000Z')
    expect(m.read.mock.calls.at(-1)?.[0].where.season).toBe(2026)
  })
  it('normalizes NHL ending years and leaves NFL years and writes unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok:true,json:async()=>({events:[event('NHL','2027-01-10T00:00:00Z',2027)]})})))
    expect((await getLiveScoresForSport({sport:'NHL',forceRefresh:true})).scores[0].season).toBe(2026)
    vi.stubGlobal('fetch', vi.fn(async () => ({ok:true,json:async()=>({events:[event('NFL','2026-10-30T00:15:00Z',2026)]})})))
    expect((await getLiveScoresForSport({sport:'NFL',forceRefresh:true})).scores[0].season).toBe(2026)
    expect(m.write.mock.calls.at(-1)?.[0].create).not.toHaveProperty('raw')
  })
  it('does not trust another provider raw payload as ESPN lock identities', async () => {
    m.rows = [{source:'thesportsdb',season:2026,week:0,seasonType:'regular',status:'scheduled',fetchedAt:new Date(),
      startTime:new Date('2026-10-30T00:00:00Z'),homeTeam:'Atlanta Hawks',awayTeam:'Cleveland Cavaliers',
      raw:{homeTeamFull:'Wrong team',awayTeamFull:'Another team'}}]
    const kickoffs = await buildWeekKickoffMap({sportsGame:{findMany:m.read}} as never,{sport:'NBA',season:2026,week:2})
    expect(kickoffs.byTeam.has('ATLANTA HAWKS')).toBe(true)
    expect(kickoffs.byTeam.has('WRONG TEAM')).toBe(false)
  })
})
