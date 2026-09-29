// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The cross-league Waivers board for every sport but the NFL.
 *
 * On origin/main the board filtered to the NFL and said nothing else. An account whose leagues
 * were basketball, hockey or soccer read "None of your leagues could be priced this week — the
 * reasons are below" with no reasons below: the leagues were dropped without a word. Each sport now
 * gets its own section — priced on its producer, or with a one-line reason when it has none.
 */

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  claimed: [] as Row[],
  rosters: [] as Row[],
  snapshots: [] as Row[],
  identity: [] as Row[],
  injuries: new Map<string, { status: string; stale: boolean }>(),
}))

function matches(row: Row, where: Row = {}): boolean {
  for (const [k, cond] of Object.entries(where)) {
    if (cond && typeof cond === 'object' && 'in' in (cond as object)) {
      if (!(cond as { in: unknown[] }).in.includes(row[k])) return false
    } else if (cond && typeof cond === 'object' && 'not' in (cond as object)) {
      if (row[k] === (cond as { not: unknown }).not) return false
    } else if (row[k] !== cond) return false
  }
  return true
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: async () => h.claimed },
    roster: { findMany: async (a: { where?: Row }) => h.rosters.filter((r) => matches(r, a.where)) },
    leagueWaiverSettings: {
      findMany: async () => [{ leagueId: 'B1', waiverType: 'FAAB', processingDayOfWeek: 1, processingTimeUtc: '08:00' }],
    },
    fantasyProjection: { findMany: async () => [] },
    sportsPlayer: { findMany: async () => [] },
    sportsGame: { findMany: async () => [] },
    aFProjectionSnapshot: {
      findFirst: async (a: { where?: Row }) => {
        const rows = h.snapshots.filter((r) => matches(r, a.where))
        return rows.length ? { season: Math.max(...rows.map((r) => Number(r.season))) } : null
      },
      findMany: async (a: { where?: Row }) => h.snapshots.filter((r) => matches(r, a.where)),
    },
    playerIdentityMap: { findMany: async (a: { where?: Row }) => h.identity.filter((r) => matches(r, a.where)) },
  },
}))
vi.mock('@/lib/core-app/rosteredMarket', () => ({
  MIN_LEAGUES_FOR_MARKET: 5,
  getRosteredMarket: async () => ({ leaguesCounted: 0, byPlayerId: new Map() }),
}))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: async () => ({ season: '2026', week: 4 }) }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  resolveInjuryFacts: async () => ({ byPlayer: new Map([...h.injuries].map(([k, v]) => [k, { ...v }])) }),
}))

import { getWaiversBoard } from '@/lib/core-app/waiversBoard'

const league = (id: string, sport: string, platform: string, settings: Row = { roster_positions: ['C', 'PG', 'UTIL', 'BN'] }) => ({
  leagueId: id,
  externalId: 'T',
  platformUserId: 'me',
  league: {
    id,
    name: `League ${id}`,
    platform,
    sport,
    settings,
    platformLeagueId: `P-${id}`,
    leagueType: 'redraft',
    scoring: 'points',
    logoUrl: null,
    avatarUrl: null,
  },
})

const snap = (playerId: string, playerName: string, position: string, afProjection: number, sport = 'NBA', over: Row = {}) => ({
  playerId,
  playerName,
  position,
  afProjection,
  sport,
  season: 2026,
  week: null,
  adjustmentFactors: null,
  computedAt: new Date('2026-09-28T00:00:00Z'),
  ...over,
})

const ident = (id: string, sport: string, over: Row = {}) => ({
  id,
  sport,
  cfbdId: null,
  currentTeam: null,
  rollingInsightsId: null,
  espnId: null,
  fantraxId: null,
  mflId: null,
  fleaflickerId: null,
  sleeperId: null,
  ...over,
})

beforeEach(() => {
  h.claimed = [
    league('B1', 'NBA', 'manual'),
    league('B2', 'NBA', 'yahoo'),
    league('B3', 'NBA', 'manual'),
    league('C1', 'NCAAF', 'manual', { roster_positions: ['WR'] }),
    league('H1', 'NHL', 'manual'),
    league('S1', 'SOCCER', 'manual'),
  ]
  h.rosters = [
    // B1: mine — a C and a PG start, a bench guard sits. Theirs holds the best centre.
    { leagueId: 'B1', platformUserId: 'me', faabRemaining: 64, playerData: { players: ['101', '102', '103'], starters: ['101', '102'] } },
    { leagueId: 'B1', platformUserId: 'them', faabRemaining: 10, playerData: { players: ['201'], starters: ['201'] } },
    // B2: a Yahoo roster — no identity column can read it.
    { leagueId: 'B2', platformUserId: 'me', faabRemaining: 5, playerData: { players: ['y1'], starters: ['y1'] } },
    // B3: no roster of mine at all.
    { leagueId: 'B3', platformUserId: 'them', faabRemaining: 5, playerData: { players: ['101'], starters: [] } },
    { leagueId: 'C1', platformUserId: 'me', faabRemaining: 5, playerData: { players: ['c1'], starters: ['c1'] } },
    { leagueId: 'H1', platformUserId: 'me', faabRemaining: 5, playerData: { players: ['h1'], starters: ['h1'] } },
  ]
  h.identity = [
    ident('k-me-c', 'NBA', { rollingInsightsId: '101' }),
    ident('k-me-pg', 'NBA', { rollingInsightsId: '102' }),
    ident('k-me-bench', 'NBA', { rollingInsightsId: '103' }),
    ident('k-theirs', 'NBA', { rollingInsightsId: '201' }),
    ident('k-hurt', 'NBA', { rollingInsightsId: '301' }),
    ident('k-free', 'NBA', { rollingInsightsId: '302', currentTeam: 'DEN' }),
    ident('k-free-2', 'NBA', { rollingInsightsId: '303' }),
    ident('k-unprovable', 'NBA', { espnId: 'e9' }),
  ]
  h.snapshots = [
    snap('k-me-c', 'Me Centre', 'C', 30),
    snap('k-me-pg', 'Me Guard', 'PG', 35),
    snap('k-me-bench', 'Me Bench', 'SG', 12),
    snap('k-theirs', 'Their Star', 'C', 55),
    snap('k-hurt', 'Hurt Star', 'C', 50),
    snap('k-free', 'Free Centre', 'C', 44),
    snap('k-free-2', 'Free Guard', 'PG', 20),
    snap('k-unprovable', 'Unprovable Star', 'PG', 60),
    snap('x-college', 'College Guy', 'WR', 9, 'NCAAF'),
  ]
  h.injuries = new Map([['hurt star', { status: 'Out', stale: false }]])
})

const sectionOf = async (sport: string) => (await getWaiversBoard('me')).sports?.find((s) => s.sport === sport)

describe('getWaiversBoard — every sport gets a section, and a sport with no producer says so', () => {
  it('prices an NBA wire on the season rate: best provable free agent vs weakest bench player', async () => {
    const nba = await sectionOf('NBA')
    expect(nba?.state).toBe('ok')
    expect(nba?.basis).toBe('season_per_game_af_default')
    expect(nba?.season).toBe(2026)
    expect(nba?.rows).toHaveLength(1)
    const row = nba!.rows[0]!
    expect(row).toMatchObject({ leagueId: 'B1', sport: 'NBA', netGain: 32, faabRemaining: 64, runsAt: 'Monday 08:00 UTC' })
    expect(row.add).toMatchObject({ name: 'Free Centre', projected: 44, team: 'DEN', ownPct: null, startPct: null })
    expect(row.drop).toMatchObject({ name: 'Me Bench', projected: 12 })
    expect(row.reasoning).toContain("projects 44.0 per game on AllFantasy's default scoring")
    expect(row.reasoning).toContain('a net +32.0 per game')
  })

  it('never names a rostered, an unprovable or a ruled-out player as the add', async () => {
    const text = JSON.stringify(await sectionOf('NBA'))
    expect(text).not.toContain('Their Star')
    expect(text).not.toContain('Unprovable Star')
    expect(text).not.toContain('Hurt Star')
  })

  it('names why each NBA league is off the section, separately', async () => {
    const nba = await sectionOf('NBA')
    expect(nba?.considered).toBe(3)
    expect(nba?.withheld).toEqual({ noRoster: 1, idSpace: 1, noScoring: 0, noCandidate: 0 })
  })

  it('says the basis in one sentence: per game, a season rate, not the league rules', async () => {
    const nba = await sectionOf('NBA')
    expect(nba?.basisLabel).toMatch(/Per-game points from AllFantasy's NBA season projection/)
    expect(nba?.basisLabel).toMatch(/not a projection for this week/)
  })

  it('withholds a college league with no scoring settings — its basis is the league rules', async () => {
    const cfb = await sectionOf('NCAAF')
    expect(cfb?.basis).toBe('season_per_game_league')
    expect(cfb?.withheld.noScoring).toBe(1)
    expect(cfb?.rows).toEqual([])
  })

  it('says the hockey producer has written nothing yet', async () => {
    const nhl = await sectionOf('NHL')
    expect(nhl?.state).toBe('no_projections')
    expect(nhl?.reason).toMatch(/NHL season projections have not been written yet/)
  })

  it('gives soccer its reason instead of dropping the league', async () => {
    const soccer = await sectionOf('SOCCER')
    expect(soccer?.state).toBe('no_producer')
    expect(soccer?.considered).toBe(1)
    expect(soccer?.reason).toMatch(/No projection exists for soccer players/)
  })

  it('keeps the sports out of the NFL rows, and counts no NFL league when there is none', async () => {
    const board = await getWaiversBoard('me')
    expect(board.rows).toEqual([])
    expect(board.considered).toBe(0)
    expect(board.sports?.map((s) => s.sport)).toEqual(['NCAAF', 'NBA', 'NHL', 'SOCCER'])
  })
})
