import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ world: vi.fn(), names: vi.fn(), league: vi.fn(), logs: vi.fn(), locks: vi.fn(), scorer: vi.fn(), game: vi.fn(), bridge: vi.fn() }))
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

import { buildOtherSportStartSit } from '@/lib/chimmy/otherSportStartSit'

const inputs = { leagueId: 'L1', userId: 'u1', players: ['Home Star', 'Away Star'] }
const row = (id: string, game: number, points: number) => ({
  playerId: id, gameId: `${id}-${game}`, providerGameId: null, sportType: 'NBA', season: 2026,
  normalizedStatMap: { pts: points, seasonType: 'regular' },
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
  h.game.mockResolvedValue({ id: 'current-game' })
  h.bridge.mockImplementation(async (_db, _sports, ids: string[]) => ({
    gameLogIds: ids, rosterIdFor: (id: string) => id,
    ambiguous: [], nameRefused: [], fantraxRefused: [],
  }))
  h.logs.mockResolvedValue([row('a', 3, 25), row('b', 3, 15), row('a', 2, 24), row('b', 2, 14), row('a', 1, 23), row('b', 1, 13)])
  h.locks.mockResolvedValue({ started: new Map(), unverified: [], kickoffs: new Map() })
})

describe('other-sport league start/sit', () => {
  it('compares current-season game form using the selected league scorer', async () => {
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(true)
    expect(out.text).toContain('Lean Home Star')
    expect(out.text).toContain('24.0 fantasy points per game')
    expect(out.text).toContain('not a projection')
    expect(h.logs.mock.calls[0][0].where).toMatchObject({ sportType: { in: ['NBA', 'nba'] }, season: 2026, playerId: { in: ['a', 'b'] } })
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
    expect(out.text).toContain('24.0 fantasy points per game over 3 recent games')
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

  it('does not claim soccer season support', async () => {
    h.world.mockResolvedValue({ league: { sport: 'SOCCER', rosterSettings: { starterSlots: ['FWD'] } } })
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(false)
    expect(out.text).toMatch(/not operational/)
  })

  it('does not reuse a past league season for an active start/sit call', async () => {
    h.game.mockResolvedValue(null)
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(false)
    expect(out.text).toMatch(/old season/)
    expect(h.logs).not.toHaveBeenCalled()
  })

  it('refuses a points ranking for category leagues', async () => {
    h.league.mockResolvedValue({ sport: 'NBA', season: 2026, settings: { scoring_type: 'categories' }, bestBallMode: false })
    const out = await buildOtherSportStartSit(inputs)
    expect(out.ready).toBe(false)
    expect(out.text).toMatch(/category or rotisserie/)
    expect(h.logs).not.toHaveBeenCalled()
  })
})
