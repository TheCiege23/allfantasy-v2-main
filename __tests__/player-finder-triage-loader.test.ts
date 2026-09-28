import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The game-day list's loader, against a mocked Prisma boundary. Three regressions
 * measured on production 2026-09-27, each pinned here:
 *
 *   1. It read only the first 40 leagues (alphabetically) — the largest account has 64.
 *   2. ESPN rosters hold ESPN ids and were never translated, so every ESPN starter vanished.
 *   3. Best-ball leagues were read like any other, so their "starters" got lineup buttons.
 */

const mockTeamFindMany = vi.hoisted(() => vi.fn())
const mockLeagueFindMany = vi.hoisted(() => vi.fn())
const mockRosterFindMany = vi.hoisted(() => vi.fn())
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn())
const mockInjuryFindMany = vi.hoisted(() => vi.fn())
const mockGameFindMany = vi.hoisted(() => vi.fn())
const mockIdentityFindMany = vi.hoisted(() => vi.fn())
const mockChoppedFindMany = vi.hoisted(() => vi.fn())
const mockEliminationFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: mockTeamFindMany },
    league: { findMany: mockLeagueFindMany },
    roster: { findMany: mockRosterFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany },
    sportsInjury: { findMany: mockInjuryFindMany },
    sportsGame: { findMany: mockGameFindMany },
    playerIdentityMap: { findMany: mockIdentityFindMany },
    // Guillotine state, read by the loader since 559c56580 to skip a team already chopped.
    guillotineRosterState: { findMany: mockChoppedFindMany },
    guillotineElimination: { findMany: mockEliminationFindMany },
  },
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 3, seasonType: 'regular' })),
}))

import { loadGameDayTriage } from '@/lib/core-app/gameDayTriageLoader'

const USER = 'me'
const NOW = '2026-09-27T15:40:00.000Z' // Sun 11:40a ET
const KICKOFF = '2026-09-27T17:00:00.000Z'

type LeagueFixture = {
  id: string
  name: string
  platform: string
  settings?: unknown
  bestBallMode?: boolean
  teamExternalId?: string
  starters: string[]
  status?: string | null
  guillotine?: boolean
  /** Extra keys on the roster's playerData (e.g. a roster-level `bestBall` flag). */
  playerData?: Record<string, unknown>
}

function wire(leagues: LeagueFixture[]) {
  mockTeamFindMany.mockImplementation(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
    leagues.filter((l) => where.leagueId.in.includes(l.id)).map((l) => ({ leagueId: l.id, platformUserId: `pu-${l.id}`, externalId: l.teamExternalId ?? '1' })),
  )
  mockLeagueFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    leagues
      .filter((l) => where.id.in.includes(l.id))
      .map((l) => ({
        id: l.id,
        name: l.name,
        platform: l.platform,
        platformLeagueId: `p-${l.id}`,
        season: 2026,
        status: l.status ?? 'in_season',
        lifecycleState: null,
        bestBallMode: l.bestBallMode ?? false,
        leagueVariant: null,
        guillotineMode: l.guillotine ?? false,
        leagueType: l.guillotine ? 'guillotine' : 'redraft',
        settings: l.settings ?? {},
      })),
  )
  mockRosterFindMany.mockImplementation(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
    leagues
      .filter((l) => where.leagueId.in.includes(l.id))
      .map((l) => ({ id: `r-${l.id}`, leagueId: l.id, platformUserId: `pu-${l.id}`, playerData: { starters: l.starters, players: l.starters, ...(l.playerData ?? {}) } })),
  )
  mockSportsPlayerFindMany.mockImplementation(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
    where.sleeperId.in.map((id) => ({ sleeperId: id, sport: 'NFL', externalId: `x-${id}`, name: `Player ${id}`, position: 'WR', team: 'NYG', imageUrl: null })),
  )
  // Every player reads Out, so every starter read is a row — the tests count leagues through them.
  mockInjuryFindMany.mockImplementation(async ({ where }: { where: { playerName: { in: string[] } } }) =>
    where.playerName.in.map((n) => ({ playerName: n, team: 'NYG', status: 'Out', description: 'Ankle', date: new Date('2026-09-25T20:00:00.000Z'), fetchedAt: new Date(NOW) })),
  )
  mockGameFindMany.mockResolvedValue([{ homeTeam: 'NYG', awayTeam: 'DAL', startTime: new Date(KICKOFF), seasonType: 'regular', venue: null }])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIdentityFindMany.mockResolvedValue([])
  mockChoppedFindMany.mockResolvedValue([])
  mockEliminationFindMany.mockResolvedValue([])
})

/*
 * The merge of #1373 with 559c56580 kept BOTH sides' skips. These pin the ones 559c56580 added —
 * which it shipped without a loader test — so a later resolution cannot drop one silently.
 */
describe('loadGameDayTriage — leagues with no lineup to fix (559c56580, kept through the merge)', () => {
  const one = (over: Partial<LeagueFixture>): LeagueFixture => ({ id: 'L1', name: 'League', platform: 'sleeper', starters: ['1001'], ...over })

  it('skips a league that is pre-draft, drafting or complete', async () => {
    wire([one({ id: 'A', status: 'pre_draft' }), one({ id: 'B', status: 'completed', starters: ['1002'] }), one({ id: 'C', starters: ['1003'] })])
    const out = await loadGameDayTriage(USER, ['A', 'B', 'C'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.leaguesRead).toBe(1)
    expect(out.data.rows.map((r) => r.player.sleeperId)).toEqual(['1003'])
  })

  it('skips a guillotine team already chopped', async () => {
    wire([one({ id: 'G', guillotine: true }), one({ id: 'S', starters: ['1002'] })])
    mockChoppedFindMany.mockResolvedValue([{ leagueId: 'G', rosterId: 'r-G' }])
    const out = await loadGameDayTriage(USER, ['G', 'S'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.rows.map((r) => r.player.sleeperId)).toEqual(['1002'])
  })

  it('a roster-level best-ball flag leaves the league out AND counts it with the other best-ball leagues', async () => {
    wire([one({ id: 'B', playerData: { bestBall: true } }), one({ id: 'S', starters: ['1002'] })])
    const out = await loadGameDayTriage(USER, ['B', 'S'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.rows.map((r) => r.player.sleeperId)).toEqual(['1002'])
    expect(out.data.bestBallLeagues).toBe(1)
  })
})

describe('loadGameDayTriage', () => {
  it('reads every league, not the first 40 alphabetically', async () => {
    // 64 leagues, each starting its own player — the largest production account.
    const leagues = Array.from({ length: 64 }, (_, i) => ({ id: `L${String(i).padStart(2, '0')}`, name: `League ${i}`, platform: 'sleeper', starters: [String(1000 + i)] }))
    wire(leagues)
    const out = await loadGameDayTriage(USER, leagues.map((l) => l.id), NOW)
    expect(out.available).toBe(true)
    if (!out.available) return
    expect(out.data.leaguesRead).toBe(64)
    expect(out.data.rows).toHaveLength(64)
    expect(out.data.leaguesNotRead).toBe(0)
    // The last league alphabetically — the one the old cap dropped — is on the list.
    expect(out.data.rows.some((r) => r.leagues.some((l) => l.leagueId === 'L63'))).toBe(true)
  })

  it('translates ESPN roster ids to Sleeper ids before reading starters', async () => {
    wire([{ id: 'E1', name: 'The League', platform: 'espn', teamExternalId: '7', starters: ['4046'] }])
    mockIdentityFindMany.mockResolvedValue([{ espnId: '4046', sleeperId: '6794' }])
    const out = await loadGameDayTriage(USER, ['E1'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.rows.map((r) => r.player.sleeperId)).toEqual(['6794'])
    // The row carries what an ESPN lineup deep link needs: the league's platform id and YOUR team id.
    expect(out.data.rows[0].leagues[0]).toMatchObject({ leagueId: 'E1', platform: 'espn', platformLeagueId: 'p-E1', season: 2026, teamId: '7' })
  })

  it('drops an ESPN id with no link instead of reading it as the Sleeper player who shares the number', async () => {
    // ESPN 4046 is unlinked; ESPN 5000 links to Sleeper 6794.
    wire([{ id: 'E1', name: 'The League', platform: 'espn', starters: ['4046', '5000'] }])
    mockIdentityFindMany.mockResolvedValue([{ espnId: '5000', sleeperId: '6794' }])
    const out = await loadGameDayTriage(USER, ['E1'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(mockSportsPlayerFindMany.mock.calls[0][0].where.sleeperId.in).toEqual(['6794'])
    expect(out.data.rows.map((r) => r.player.sleeperId)).toEqual(['6794'])
  })

  it('counts a Yahoo/MFL league instead of reading its ids as Sleeper ids', async () => {
    wire([
      { id: 'Y1', name: 'Yahoo League', platform: 'yahoo', starters: ['33'] },
      { id: 'S1', name: 'Sleeper League', platform: 'sleeper', starters: ['44'] },
    ])
    const out = await loadGameDayTriage(USER, ['Y1', 'S1'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.unsupportedLeagues).toBe(1)
    expect(out.data.rows.map((r) => r.player.sleeperId)).toEqual(['44'])
  })

  it('leaves best-ball leagues out and counts them', async () => {
    wire([
      { id: 'B1', name: 'Neutral name', platform: 'sleeper', bestBallMode: true, starters: ['1'] },
      { id: 'B2', name: 'Tap BB #3', platform: 'sleeper', settings: { best_ball: 1 }, starters: ['2'] },
      { id: 'N1', name: 'KBFL', platform: 'sleeper', starters: ['1', '3'] },
      // A NAME is not the rule (#1371): read as a normal lineup until the provider flag says otherwise.
      { id: 'N2', name: 'Dynasty BestBall League!', platform: 'sleeper', settings: { best_ball: 0 }, starters: ['4'] },
    ])
    const out = await loadGameDayTriage(USER, ['B1', 'B2', 'N1', 'N2'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.bestBallLeagues).toBe(2)
    expect(out.data.leaguesRead).toBe(2)
    expect(out.data.rows.some((r) => r.player.sleeperId === '4')).toBe(true)
    // Player 1 starts in the best-ball league and in KBFL: listed once, for KBFL only.
    const p1 = out.data.rows.find((r) => r.player.sleeperId === '1')!
    expect(p1.leagues.map((l) => l.leagueId)).toEqual(['N1'])
    expect(out.data.rows.some((r) => r.player.sleeperId === '2')).toBe(false)
  })

  it('says how many leagues it did not read when an account passes the bound', async () => {
    const leagues = Array.from({ length: 260 }, (_, i) => ({ id: `L${i}`, name: `League ${i}`, platform: 'sleeper', starters: [String(i)] }))
    wire(leagues)
    const out = await loadGameDayTriage(USER, leagues.map((l) => l.id), NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.leaguesNotRead).toBe(10)
  })
})

/*
 * Fleaflicker / MFL leagues read through the identity bridge (bridgedRosterIds.ts), exactly as the
 * finder does. Their raw ids collide with Sleeper's — '6038' here is a real Sleeper id AND a
 * Fleaflicker id — so a league is read only when most of its ids bridge, and an unbridged id is
 * dropped rather than read raw.
 */
describe('loadGameDayTriage — bridged Fleaflicker leagues', () => {
  const bridge = (pairs: Record<string, string>) =>
    mockIdentityFindMany.mockImplementation(async ({ where }: { where: Record<string, { in?: string[] }> }) =>
      (where.fleaflickerId?.in ?? []).filter((id) => pairs[id]).map((id) => ({ fleaflickerId: id, sleeperId: pairs[id] })),
    )

  it('a league the bridge covers is read — in Sleeper ids, never the colliding raw id', async () => {
    wire([{ id: 'F1', name: 'Flea League', platform: 'fleaflicker', starters: ['6038', '777'] }])
    bridge({ '6038': 'S-JAMARR', '777': 'S-MOSS' })
    const out = await loadGameDayTriage(USER, ['F1'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.unsupportedLeagues).toBe(0)
    expect(out.data.leaguesRead).toBe(1)
    const ids = out.data.rows.map((r) => r.player.sleeperId).sort()
    expect(ids).toEqual(['S-JAMARR', 'S-MOSS'])
    expect(ids).not.toContain('6038')
  })

  it('a league below the coverage bar stays unsupported, and nothing in it is read', async () => {
    wire([{ id: 'F2', name: 'Flea League', platform: 'fleaflicker', starters: ['6038', '777'] }])
    bridge({ '6038': 'S-JAMARR' }) // 1 of 2 = 50% < 80%
    const out = await loadGameDayTriage(USER, ['F2'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.unsupportedLeagues).toBe(1)
    expect(out.data.leaguesRead).toBe(0)
    expect(out.data.rows).toEqual([])
  })
})
