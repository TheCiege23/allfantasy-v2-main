import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ world: vi.fn(), names: vi.fn(), league: vi.fn(), logs: vi.fn(), locks: vi.fn(), scorer: vi.fn(), schedule: vi.fn(), bridge: vi.fn(), injuries: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league }, playerGameStat: { findMany: h.logs }, sportsGame: { findFirst: h.game } } }))
vi.mock('@/lib/decision-os/world', () => ({ resolveCanonicalWorld: h.world }))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveNames: h.names }))
vi.mock('@/lib/chimmy/leagueRosterIndex', () => ({
  viewerRosterOf: () => ({ playerIds: ['a', 'b'], starterIds: ['a'], reserveIds: [], taxiIds: [] }),
  activePlayerIds: () => ['a', 'b'],
}))
vi.mock('@/lib/redraft/scoringEngine', () => ({ buildLeagueStatScorer: h.scorer }))
vi.mock('@/lib/redraft/rosterGameLogIdBridge', () => ({ bridgeRosterIdsToGameLogIds: h.bridge }))
vi.mock('@/lib/chimmy/actions/gameLocks', () => ({ checkStartedGames: h.locks }))
vi.mock('@/lib/chimmy/otherSportPeriodSchedule', () => ({ loadOtherSportPeriodSchedule: h.schedule }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.injuries }))

import { buildOtherSportStartSit } from '@/lib/chimmy/otherSportStartSit'

const inputs = { leagueId: 'L1', userId: 'u1', players: ['Home Star', 'Away Star'] }
const row = (id: string, game: number, points: number) => ({
  playerId: id, gameId: `${id}-${game}`, providerGameId: null, sportType: 'NBA', season: 2026,
  normalizedStatMap: { stats: { points }, seasonType: 'regular' },
  gameDate: new Date(`2026-10-${20 + game}T00:00:00Z`), weekOrRound: 2,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.world.mockResolvedValue({ league: { sport: 'NBA', rosterSettings: { starterSlots: ['G', 'BN'] } }, provenance: { provider: 'allfantasy' } })
  h.names.mockResolvedValue(new Map([
    ['a', { name: 'Home Star', position: 'PG', team: 'BOS', injury: null }],
    ['b', { name: 'Away Star', position: 'SG', team: 'NYK', injury: null }],
  ]))
  h.league.mockResolvedValue({ sport: 'NBA', season: 2026, settings: {}, bestBallMode: false })
  h.scorer.mockReturnValue((stats: { pts?: number }) => stats.pts ?? 0)
  h.schedule.mockResolvedValue({ label: 'season 2026, scoring week 1', source: 'schedule', byTeam: new Map([
    ['BOS', { count: 2, opponents: ['NYK', 'CHI'], verified: true }],
    ['NYK', { count: 1, opponents: ['BOS'], verified: true }],
  ]) })
  h.bridge.mockImplementation(async (_db, _sports, ids: string[]) => ({
    gameLogIds: ids, rosterIdFor: (id: string) => id,
    ambiguous: [], nameRefused: [], fantraxRefused: [],
  }))
  h.logs.mockResolvedValue([row('a', 3, 25), row('b', 3, 15), row('a', 2, 24), row('b', 2, 14), row('a', 1, 23), row('b', 1, 13)])
  h.locks.mockResolvedValue({ started: new Map(), unverified: [], kickoffs: new Map() })
  h.injuries.mockResolvedValue({ byPlayer: new Map(), ambiguous: [], feedStale: false,
    coverage: { sourceAvailable: true, reason: null } })
})

describe('other-sport league start/sit', () => {
  it('compares current-season game form using the selected league scorer', async () => {
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(true)
    expect(out.text).toContain('Lean Home Star')
    expect(out.text).toContain('24.0 league-scored points per recent game, 48.0 schedule-adjusted baseline')
    expect(out.text).toContain('not a certified projection')
    expect(h.logs.mock.calls[0][0].where).toMatchObject({ sportType: { in: ['NBA', 'nba'] }, playerId: { in: ['a', 'b'] }, gameDate: { gte: expect.any(Date), lte: expect.any(Date) } })
  })

  it('uses the verified game-log identity for a roster player', async () => {
    h.bridge.mockResolvedValue({
      gameLogIds: ['identity-a', 'identity-b'],
      rosterIdFor: (id: string) => ({ 'identity-a': 'a', 'identity-b': 'b' })[id],
      ambiguous: [], nameRefused: [], fantraxRefused: [],
    })
    h.logs.mockResolvedValue([row('identity-a', 3, 25), row('identity-b', 3, 15), row('identity-a', 2, 24), row('identity-b', 2, 14), row('identity-a', 1, 23), row('identity-b', 1, 13)])
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(true)
    expect(out.text).toContain('Lean Home Star')
    expect(h.logs.mock.calls[0][0].where.playerId.in).toEqual(['identity-a', 'identity-b'])
  })

  it('excludes preseason rows and combines multiple stat lines from one game', async () => {
    h.logs.mockResolvedValue([
      { ...row('a', 4, 100), normalizedStatMap: { pts: 100, seasonType: 'pre' } },
      { ...row('a', 3, 20), gameId: 'a-3:batting', providerGameId: 'a-3' },
      { ...row('a', 3, 5), gameId: 'a-3:pitching', providerGameId: 'a-3' },
      row('a', 2, 24), row('a', 1, 23),
      row('b', 3, 15), row('b', 2, 14), row('b', 1, 13),
    ])
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(true)
    expect(out.text).toContain('24.0 league-scored points per recent game')
  })

  it('withholds advice when the game lock could not be verified', async () => {
    h.locks.mockResolvedValue({ started: new Map(), unverified: ['b'] })
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(false)
    expect(out.text).toMatch(/could not be verified/)
  })

  it('withholds advice when no current-season games are stored', async () => {
    h.logs.mockResolvedValue([])
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(false)
    expect(out.text).toMatch(/Not enough current-season game logs/)
    expect(h.locks).not.toHaveBeenCalled()
  })

  it('compares soccer gameweek form only when league roster and fixtures verify', async () => {
    h.world.mockResolvedValue({ league: { sport: 'SOCCER', rosterSettings: { starterSlots: ['FWD'] } } })
    h.league.mockResolvedValue({ sport: 'SOCCER', season: 2026, settings: {}, bestBallMode: false })
    h.names.mockResolvedValue(new Map([
      ['a', { name: 'Home Star', position: 'FWD', team: 'Arsenal', injury: null }],
      ['b', { name: 'Away Star', position: 'FWD', team: 'Chelsea', injury: null }],
    ]))
    h.scorer.mockReturnValue((stats: { goals?: number }) => (stats.goals ?? 0) * 6)
    h.schedule.mockResolvedValue({ label: 'gameweek 10', source: 'season schedule', byTeam: new Map([
      ['Arsenal', { count: 2, opponents: ['Chelsea'], verified: true }],
      ['Chelsea', { count: 1, opponents: ['Arsenal'], verified: true }],
    ]) })
    h.logs.mockResolvedValue(['a', 'b'].flatMap((id) => [1, 2, 3].map((game) => ({
      ...row(id, game, 0), sportType: 'SOCCER', normalizedStatMap: {
        group: 'fielders', position: 'forward', stats: { goals: id === 'a' ? 2 : 1, minutes_played: 90 }, seasonType: 'regular',
      },
    }))))
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(true)
    expect(out.text).toContain('Lean Home Star')
    expect(out.text).toContain('Soccer season finalization is not certified')
  })

  it('does not reuse a past league season for an active start/sit call', async () => {
    h.schedule.mockResolvedValue(null)
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(false)
    expect(out.text).toMatch(/old season or partial slate/)
    expect(h.logs).not.toHaveBeenCalled()
  })

  it('refuses a points ranking for category leagues', async () => {
    h.league.mockResolvedValue({ sport: 'NBA', season: 2026, settings: { scoring_type: 'categories' }, bestBallMode: false })
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(false)
    expect(out.text).toMatch(/category list.*not verified/)
    expect(h.logs).not.toHaveBeenCalled()
  })

  it('reports verified category contributions without an overall fantasy-points winner', async () => {
    h.league.mockResolvedValue({ sport: 'NBA', season: 2026,
      settings: { scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat', category_record_mode: 'most' },
      bestBallMode: false })
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(true)
    expect(out.text).toContain('PTS: Home Star')
    expect(out.text).toContain('No overall category winner')
    expect(out.text).not.toContain('schedule-adjusted baseline')
  })

  it('refuses a fresh out designation from the canonical injury reader', async () => {
    h.injuries.mockResolvedValue({ byPlayer: new Map([['home star', {
      status: 'Out', stale: false, reportedAt: new Date('2026-11-01T12:00:00Z'),
    }]]), ambiguous: [], feedStale: false, coverage: { sourceAvailable: true, reason: null } })
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(false)
    expect(out.text).toMatch(/current Out injury designation/)
  })
})
