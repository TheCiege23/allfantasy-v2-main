import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  raw: vi.fn(), players: vi.fn(), injuries: vi.fn(), projections: vi.fn(), latest: vi.fn(), byes: vi.fn(),
  afEngine: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $queryRawUnsafe: h.raw, sportsPlayer: { findMany: h.players }, sportsInjury: { findMany: h.injuries },
} }))
// `afEngineForLeague` stays REAL: it is the arithmetic under test in the AF-engine block below.
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  afEngineForLeague: (await importOriginal<typeof import('@/lib/core-app/playerProjections')>()).afEngineForLeague,
  lookupProjections: h.projections,
  latestProjectionWeek: h.latest,
  lookupAfEngineProjections: h.afEngine,
}))
vi.mock('@/lib/core-app/byeWeeks', () => ({ getByeWeeks: h.byes }))

import { loadRailProjections } from '@/lib/core-app/railMatchups'

const starters = ['out', 'ir', 'healthy', 'question', 'unknown', 'bye', 'missing-out', 'missing']
const feed = () => new Map([
  ['out', { projectedPoints: 25, componentStats: { rec: 5 } }],
  ['ir', { projectedPoints: 9, componentStats: { rec: 4 } }],
  ['healthy', { projectedPoints: 15, componentStats: { rec: 2 } }],
  ['question', { projectedPoints: 8, componentStats: { rec: 3 } }],
  ['unknown', { projectedPoints: 11, componentStats: { rec: 1 } }],
  ['bye', { projectedPoints: 4, componentStats: { rec: 1 } }],
])
const meta = (id: string, scoring: unknown = { rec: 1 }, sport = 'NFL') => ({
  id, sport, scoring_settings: scoring, scoringSettings: null, yahoo_settings: null,
  confirmedType: null, leagueType: 'dynasty', guillotineMode: false,
})
const rows = () => starters.map((id) => ({
  sleeperId: id, name: id === 'ir' ? 'Omar Cooper' : id, team: 'NYJ', sport: 'NFL',
}))
const fixtures = (ids = ['L1']) => ({
  fixtures: ids.map((id) => ({ dbLeagueId: id, platformLeagueId: id, rosterIds: ['team'] })),
  teamByKey: new Map(ids.map((id) => [id + ':team', { externalId: 'team', rosterKeys: ['user'] }])),
  season: 2026, week: 3,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.raw.mockReset().mockResolvedValueOnce([meta('L1')])
    .mockResolvedValueOnce([{ leagueId: 'L1', platformUserId: 'user', starters }])
  h.players.mockReset().mockResolvedValue(rows())
  h.injuries.mockReset().mockResolvedValue([
    // A newer report for another club must not clear this player's IR status.
    { playerName: 'Omar Cooper Jr.', status: 'Active', team: 'SF' },
    { playerName: 'Omar Cooper Jr.', status: 'IR', team: 'NYJ' },
    { playerName: 'out', status: 'Out', team: 'NYJ' },
    { playerName: 'missing-out', status: 'Out', team: 'NYJ' },
    { playerName: 'question', status: 'Questionable', team: 'NYJ' },
  ])
  h.projections.mockReset().mockResolvedValue(feed())
  h.latest.mockReset().mockResolvedValue(null)
  h.afEngine.mockReset().mockResolvedValue(new Map())
  h.byes.mockReset().mockResolvedValue({ byWeek: new Map([[3, ['bye']]]) })
})

describe('rail projections use the roster availability rules', () => {
  it('zeroes Out, alias-matched IR and verified byes without zeroing questionable or unknown players', async () => {
    const result = await loadRailProjections(fixtures())
    expect(result.byLeague.get('L1')?.sides.get('team')).toEqual({
      projected: 34, afProjected: 6, afEngine: null, afEngineFrom: 4, pricedFrom: 7, starterCount: 8,
    })
    // Missing-out is a known zero; missing remains an explicit coverage gap.
    expect(h.injuries).toHaveBeenCalledTimes(1)
    expect(h.injuries.mock.calls[0][0].where.sport).toBe('NFL')
  })

  it('batches the same identities and injury read across many league lineups', async () => {
    const ids = Array.from({ length: 65 }, (_, i) => 'L' + i)
    h.raw.mockReset().mockResolvedValueOnce(ids.map((id) => meta(id)))
      .mockResolvedValueOnce(ids.map((id) => ({ leagueId: id, platformUserId: 'user', starters })))
    const result = await loadRailProjections(fixtures(ids))
    expect(result.byLeague.size).toBe(65)
    expect(h.raw).toHaveBeenCalledTimes(2)
    expect(h.players).toHaveBeenCalledTimes(1)
    expect(h.injuries).toHaveBeenCalledTimes(1)
    expect(h.byes).toHaveBeenCalledTimes(1)
  })

  it('does not invent a league-scored zero when the scoring rules are unavailable', async () => {
    h.raw.mockReset().mockResolvedValueOnce([meta('L1', null)])
      .mockResolvedValueOnce([{ leagueId: 'L1', platformUserId: 'user', starters: ['out'] }])
    const side = (await loadRailProjections(fixtures())).byLeague.get('L1')?.sides.get('team')
    expect(side).toEqual({ projected: 0, afProjected: null, afEngine: null, afEngineFrom: 1, pricedFrom: 1, starterCount: 1 })
  })

  it('honors a newer club-compatible clearance instead of an older Out report', async () => {
    h.injuries.mockResolvedValue([
      { playerName: 'out', status: 'Active', team: 'NYJ' },
      { playerName: 'out', status: 'Out', team: 'NYJ' },
    ])
    h.byes.mockResolvedValue(null)
    h.raw.mockReset().mockResolvedValueOnce([meta('L1')])
      .mockResolvedValueOnce([{ leagueId: 'L1', platformUserId: 'user', starters: ['out'] }])
    expect((await loadRailProjections(fixtures())).byLeague.get('L1')?.sides.get('team')?.projected).toBe(25)
  })

  it('does not apply this weeks injuries or byes to another weeks fallback projection', async () => {
    h.projections.mockResolvedValueOnce(new Map()).mockResolvedValueOnce(feed())
    h.latest.mockResolvedValue({ season: '2026', week: 4 })
    const result = await loadRailProjections(fixtures())
    expect(result.projectionWeek).toEqual({ season: '2026', week: 4 })
    expect(result.byLeague.get('L1')?.sides.get('team')?.projected).toBe(72)
    expect(h.players).not.toHaveBeenCalled()
    expect(h.injuries).not.toHaveBeenCalled()
    expect(h.byes).not.toHaveBeenCalled()
  })

  it('keeps projections when injury identity reads fail instead of declaring players absent', async () => {
    h.players.mockRejectedValue(new Error('store unavailable'))
    h.byes.mockResolvedValue(null)
    const result = await loadRailProjections(fixtures())
    expect(result.byLeague.get('L1')?.sides.get('team')?.projected).toBe(72)
    expect(h.injuries).not.toHaveBeenCalled()
  })

  it('keeps each sports injury evidence within its own league cohort', async () => {
    h.raw.mockReset().mockResolvedValueOnce([meta('L1'), meta('L2', { rec: 1 }, 'NBA')])
      .mockResolvedValueOnce(['L1', 'L2'].map((leagueId) => ({ leagueId, platformUserId: 'user', starters: ['out'] })))
    h.players.mockResolvedValue([
      { sleeperId: 'out', name: 'out', team: 'NYJ', sport: 'NFL' },
      { sleeperId: 'out', name: 'another athlete', team: 'BKN', sport: 'NBA' },
    ])
    h.injuries.mockImplementation(async (args) => args.where.sport === 'NFL'
      ? [{ playerName: 'out', status: 'Out', team: 'NYJ' }] : [])
    h.byes.mockResolvedValue(null)
    const result = await loadRailProjections(fixtures(['L1', 'L2']))
    expect(result.byLeague.get('L1')?.sides.get('team')?.projected).toBe(0)
    expect(result.byLeague.get('L2')?.sides.get('team')?.projected).toBe(25)
  })
})

/*
 * A foreign-id league prices NOTHING. Fleaflicker ids are short numbers in Sleeper's range (44 of 248
 * on the one production Fleaflicker league ARE Sleeper ids); the rail skips the crosswalk, so its
 * starters used to price whichever Sleeper players shared those numbers into the side's total.
 */
describe('rail projections — a foreign-id league', () => {
  it('prices no starter of a Fleaflicker league, however many of its ids are also Sleeper ids', async () => {
    h.raw.mockReset().mockResolvedValueOnce([{ ...meta('L1'), platform: 'fleaflicker' }])
      .mockResolvedValueOnce([{ leagueId: 'L1', platformUserId: 'user', starters }])
    const result = await loadRailProjections(fixtures())
    expect(result.byLeague.get('L1')?.sides.get('team')?.projected ?? null).toBeNull()
    expect(h.projections).not.toHaveBeenCalled()
  })

  it('control: the same starters in a Sleeper league are priced', async () => {
    h.raw.mockReset().mockResolvedValueOnce([{ ...meta('L1'), platform: 'sleeper' }])
      .mockResolvedValueOnce([{ leagueId: 'L1', platformUserId: 'user', starters }])
    const result = await loadRailProjections(fixtures())
    expect(result.byLeague.get('L1')?.sides.get('team')?.projected).toBe(34)
  })
})

/*
 * The AF ENGINE column — AllFantasy's own projection beside the provider's. It is a scalar under
 * generic PPR, carried into the league by the provider line's own league/PPR ratio.
 */
describe('rail projections — the AF engine column', () => {
  beforeEach(() => {
    h.byes.mockResolvedValue(null)
    h.injuries.mockResolvedValue([])
  })

  it('sums the engine for the same starters, scaled by the provider line into this league', async () => {
    // Provider: healthy 15 PPR -> league 2 (rec:1 x 2). Engine 30 PPR -> 30 x 2/15 = 4.
    // unknown: provider 11 -> league 1; engine 22 -> 2. Total 6.
    h.raw.mockReset().mockResolvedValueOnce([meta('L1')])
      .mockResolvedValueOnce([{ leagueId: 'L1', platformUserId: 'user', starters: ['healthy', 'unknown'] }])
    h.afEngine.mockResolvedValue(new Map([
      ['healthy', { playerId: 'healthy', projectedPoints: 30, basis: null, confidence: null }],
      ['unknown', { playerId: 'unknown', projectedPoints: 22, basis: null, confidence: null }],
    ]))
    const side = (await loadRailProjections(fixtures())).byLeague.get('L1')?.sides.get('team')
    expect(side?.afEngine).toBe(6)
    expect(side?.afEngineFrom).toBe(2)
    // Asked for the week the provider numbers came from, so the two columns describe one week.
    expect(h.afEngine.mock.calls[0][1]).toEqual({ season: '2026', week: 3 })
  })

  it('keeps an engine number the provider does not carry, as PPR, rather than dropping it', async () => {
    h.raw.mockReset().mockResolvedValueOnce([meta('L1')])
      .mockResolvedValueOnce([{ leagueId: 'L1', platformUserId: 'user', starters: ['missing'] }])
    h.afEngine.mockResolvedValue(new Map([['missing', { playerId: 'missing', projectedPoints: 9.5, basis: null, confidence: null }]]))
    const side = (await loadRailProjections(fixtures())).byLeague.get('L1')?.sides.get('team')
    expect(side?.afEngine).toBe(9.5)
    expect(side?.projected).toBeNull()
  })

  it('a failed engine read leaves the provider columns exactly as they were', async () => {
    h.raw.mockReset().mockResolvedValueOnce([meta('L1')])
      .mockResolvedValueOnce([{ leagueId: 'L1', platformUserId: 'user', starters: ['healthy'] }])
    h.afEngine.mockRejectedValue(new Error('read failed'))
    const side = (await loadRailProjections(fixtures())).byLeague.get('L1')?.sides.get('team')
    expect(side?.projected).toBe(15)
    expect(side?.afEngine).toBeNull()
  })
})
