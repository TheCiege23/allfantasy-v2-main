import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The War Room's Game Plan (and the Player Finder's game-day list) read through
 * `loadGameDayTriage`. Two defects pinned here, both silent on screen:
 *
 *   1. ONE SPORT FOR THE WHOLE ACCOUNT. The loader took the sport of whichever catalog row came
 *      back first and used it for the injury read, the week and the kickoffs. An NBA row first
 *      meant NFL injuries were never read — "No starter in any of your leagues is flagged".
 *   2. EMPTY SLOTS DROPPED. '0' in `starters` was filtered out as noise; an empty slot is the
 *      most certain zero a lineup has.
 *
 * ⚠ THE CATALOG MOCK RETURNS EVERY SPORT WHEN NOT ASKED FOR ONE, NBA FIRST. That is the shape
 * that broke production; a mock that honoured an absent filter by returning NFL only would let
 * the old loader pass.
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
    guillotineRosterState: { findMany: mockChoppedFindMany },
    guillotineElimination: { findMany: mockEliminationFindMany },
  },
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 3, seasonType: 'regular' })),
}))

import { loadGameDayTriage } from '@/lib/core-app/gameDayTriageLoader'

const USER = 'me'
const NOW = '2026-09-27T15:40:00.000Z'
const KICKOFF = '2026-09-27T17:00:00.000Z'

type Fixture = { id: string; sport: string; starters: string[] }

/** Catalog: one row per (sport, id). NBA rows are listed first on purpose — see the header. */
const CATALOG = [
  { sleeperId: '500', sport: 'NBA', externalId: 'nba-500', name: 'Hoop Star', position: 'G', team: 'LAC', imageUrl: null },
  { sleeperId: '77', sport: 'NBA', externalId: 'nba-77', name: 'Hoop Namesake', position: 'F', team: 'MIA', imageUrl: null },
  { sleeperId: '1001', sport: 'NFL', externalId: 'nfl-1001', name: 'Gridiron Hurt', position: 'WR', team: 'NYG', imageUrl: null },
  { sleeperId: '77', sport: 'NFL', externalId: 'nfl-77', name: 'Gridiron Seventy', position: 'RB', team: 'NYG', imageUrl: null },
]

function wire(leagues: Fixture[]) {
  mockTeamFindMany.mockImplementation(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
    leagues.filter((l) => where.leagueId.in.includes(l.id)).map((l) => ({ id: `t-${l.id}`, leagueId: l.id, platformUserId: `pu-${l.id}`, externalId: '1' })),
  )
  mockLeagueFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    leagues
      .filter((l) => where.id.in.includes(l.id))
      .map((l) => ({
        id: l.id,
        name: `League ${l.id}`,
        platform: 'sleeper',
        platformLeagueId: `p-${l.id}`,
        season: 2026,
        status: 'in_season',
        lifecycleState: null,
        bestBallMode: false,
        leagueVariant: null,
        guillotineMode: false,
        leagueType: 'redraft',
        settings: {},
        sport: l.sport,
      })),
  )
  mockRosterFindMany.mockImplementation(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
    leagues
      .filter((l) => where.leagueId.in.includes(l.id))
      .map((l) => ({ id: `r-${l.id}`, leagueId: l.id, platformUserId: `pu-${l.id}`, playerData: { starters: l.starters, players: l.starters.filter((s) => s !== '0') }, updatedAt: new Date(NOW) })),
  )
  mockSportsPlayerFindMany.mockImplementation(async ({ where }: { where: { sport?: string; sleeperId: { in: string[] } } }) =>
    CATALOG.filter((p) => where.sleeperId.in.includes(p.sleeperId) && (where.sport == null || p.sport === where.sport)),
  )
  // Everyone the feed is asked about reads Out — but only in the sport the read names.
  const hurt: Record<string, string[]> = { NFL: ['Gridiron Hurt', 'Gridiron Seventy'], NBA: ['Hoop Star', 'Hoop Namesake'] }
  mockInjuryFindMany.mockImplementation(async ({ where }: { where: { sport: string; playerName: { in: string[] } } }) =>
    where.playerName.in
      .filter((n) => (hurt[where.sport] ?? []).includes(n))
      .map((n) => ({ playerName: n, team: null, status: 'Out', description: 'Ankle', date: new Date('2026-09-25T20:00:00.000Z'), fetchedAt: new Date(NOW) })),
  )
  // An NFL slate that ALSO names LAC and MIA — the abbreviations an NBA club shares with an NFL one.
  mockGameFindMany.mockResolvedValue([
    { homeTeam: 'NYG', awayTeam: 'DAL', startTime: new Date(KICKOFF), seasonType: 'regular', venue: null },
    { homeTeam: 'LAC', awayTeam: 'MIA', startTime: new Date('2026-09-27T20:05:00.000Z'), seasonType: 'regular', venue: null },
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIdentityFindMany.mockResolvedValue([])
  mockChoppedFindMany.mockResolvedValue([])
  mockEliminationFindMany.mockResolvedValue([])
})

describe('loadGameDayTriage — each league read in its own sport', () => {
  it('flags the NFL starter even when the catalog hands back an NBA row first', async () => {
    wire([
      { id: 'HOOPS', sport: 'NBA', starters: ['500'] },
      { id: 'FOOT', sport: 'NFL', starters: ['1001'] },
    ])
    const out = await loadGameDayTriage(USER, ['HOOPS', 'FOOT'], NOW)
    if (!out.available) throw new Error(out.reason)
    const names = out.data.rows.map((r) => r.player.name).sort()
    expect(names).toEqual(['Gridiron Hurt', 'Hoop Star'])
    // Each injury read names its own sport, and the catalog is never read sport-blind.
    expect(mockInjuryFindMany.mock.calls.map(([a]) => a.where.sport).sort()).toEqual(['NBA', 'NFL'])
    for (const [args] of mockSportsPlayerFindMany.mock.calls) expect(args.where.sport).toBeTruthy()
  })

  it('gives an NFL starter his kickoff, and an NBA starter none — never an NFL club’s game, never NO GAME', async () => {
    wire([
      { id: 'HOOPS', sport: 'NBA', starters: ['500'] },
      { id: 'FOOT', sport: 'NFL', starters: ['1001'] },
    ])
    const out = await loadGameDayTriage(USER, ['HOOPS', 'FOOT'], NOW)
    if (!out.available) throw new Error(out.reason)
    const nfl = out.data.rows.find((r) => r.player.name === 'Gridiron Hurt')!
    const nba = out.data.rows.find((r) => r.player.name === 'Hoop Star')!
    expect(nfl.kickoff).toBe(KICKOFF)
    // LAC is on the NFL slate above; the Clippers must not inherit the Chargers' kickoff.
    expect(nba.kickoff).toBeNull()
    expect(nba.noGame).toBe(false)
    // The schedule is only read for the sport whose clubs it can fold.
    expect(mockGameFindMany.mock.calls.map(([a]) => a.where.sport)).toEqual(['NFL'])
  })

  it('resolves a Sleeper id shared by two sports to each league’s own player', async () => {
    wire([
      { id: 'HOOPS', sport: 'NBA', starters: ['77'] },
      { id: 'FOOT', sport: 'NFL', starters: ['77'] },
    ])
    const out = await loadGameDayTriage(USER, ['HOOPS', 'FOOT'], NOW)
    if (!out.available) throw new Error(out.reason)
    const byLeague = Object.fromEntries(out.data.rows.flatMap((r) => r.leagues.map((l) => [l.leagueId, `${r.player.sport}:${r.player.name}`])))
    expect(byLeague).toEqual({ HOOPS: 'NBA:Hoop Namesake', FOOT: 'NFL:Gridiron Seventy' })
  })

  it('keeps the soonest lock first across sports', async () => {
    wire([
      { id: 'HOOPS', sport: 'NBA', starters: ['500'] },
      { id: 'FOOT', sport: 'NFL', starters: ['1001'] },
    ])
    const out = await loadGameDayTriage(USER, ['HOOPS', 'FOOT'], NOW)
    if (!out.available) throw new Error(out.reason)
    // A row with a kickoff ahead sorts before one with none.
    expect(out.data.rows.map((r) => r.player.name)).toEqual(['Gridiron Hurt', 'Hoop Star'])
    expect(out.data.week).toEqual({ season: 2026, week: 3 })
  })
})

describe('loadGameDayTriage — empty starting slots', () => {
  it("counts '0' slots per league and never looks '0' up as a player", async () => {
    wire([{ id: 'FOOT', sport: 'NFL', starters: ['0', '1001', '0'] }])
    const out = await loadGameDayTriage(USER, ['FOOT'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.emptySlots).toEqual([expect.objectContaining({ leagueId: 'FOOT', count: 2, platform: 'sleeper', platformLeagueId: 'p-FOOT' })])
    for (const [args] of mockSportsPlayerFindMany.mock.calls) expect(args.where.sleeperId.in).not.toContain('0')
  })

  it('reports empty slots even when the lineup has no other starter to read', async () => {
    wire([{ id: 'FOOT', sport: 'NFL', starters: ['0', '0'] }])
    const out = await loadGameDayTriage(USER, ['FOOT'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.rows).toEqual([])
    expect(out.data.emptySlots).toEqual([expect.objectContaining({ leagueId: 'FOOT', count: 2 })])
  })

  it('reports none for a full lineup', async () => {
    wire([{ id: 'FOOT', sport: 'NFL', starters: ['1001'] }])
    const out = await loadGameDayTriage(USER, ['FOOT'], NOW)
    if (!out.available) throw new Error(out.reason)
    expect(out.data.emptySlots).toEqual([])
  })
})
