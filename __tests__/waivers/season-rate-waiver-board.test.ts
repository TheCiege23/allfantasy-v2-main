// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The one-league "Worth adding" board outside the NFL.
 *
 * `loadWaiverBoard` never read the league's sport. Every query under it is NFL — Sleeper ids,
 * `playerGameStat` for `sportType: 'NFL'`, the NFL projection feed — so on origin/main:
 *
 *   - a college football league was offered NFL players: no college id is an NFL roster id, so
 *     every NFL player read as a free agent, and a college id that happens to equal a Sleeper id
 *     was priced as that NFL player; and
 *   - a basketball or soccer league got an NFL-shaped answer that said nothing true about its wire.
 *
 * The NFL doubles below are live on purpose: they are what the pre-fix loader reads, so the tests
 * that forbid NFL names go red against it and green only once a non-NFL league leaves the NFL path.
 */

type IdentityRow = {
  id: string
  cfbdId: string | null
  currentTeam: string | null
  rollingInsightsId: string | null
  espnId: string | null
  fantraxId: string | null
  mflId: string | null
  fleaflickerId: string | null
  sleeperId: string | null
  sport: string
}

const h = vi.hoisted(() => ({
  league: null as null | Record<string, unknown>,
  myRoster: { players: [] as unknown[], starters: [] as unknown[] } as Record<string, unknown>,
  otherRosters: [] as Array<{ playerData: unknown }>,
  snapshots: [] as Array<Record<string, unknown>>,
  identity: [] as IdentityRow[],
}))

const ident = (over: Partial<IdentityRow> & { id: string; sport: string }): IdentityRow => ({
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

const snap = (playerId: string, playerName: string, position: string, afProjection: number, over: Record<string, unknown> = {}) => ({
  playerId,
  playerName,
  position,
  afProjection,
  sport: 'NBA',
  season: 2026,
  week: null,
  adjustmentFactors: null,
  computedAt: new Date('2026-09-28T00:00:00Z'),
  ...over,
})

/* A tiny `where` evaluator — enough for `{ sport, week, season, playerId: { in } }` and `{ sport, [col]: { in } }`. */
function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  for (const [k, cond] of Object.entries(where)) {
    if (cond && typeof cond === 'object' && 'in' in (cond as object)) {
      if (!(cond as { in: unknown[] }).in.includes(row[k])) return false
    } else if (row[k] !== cond) return false
  }
  return true
}

const prismaDouble = {
  league: {
    findUnique: async () => h.league,
    findFirst: async () => null,
  },
  leagueTeam: { findFirst: async () => ({ platformUserId: 'me', externalId: 'T1' }) },
  roster: {
    findFirst: async () => ({ playerData: h.myRoster }),
    findMany: async () => [{ id: 'r-me', platformUserId: 'me', playerData: h.myRoster }, ...h.otherRosters],
  },
  aFProjectionSnapshot: {
    findFirst: async (args: { where?: Record<string, unknown> }) => {
      const rows = h.snapshots.filter((r) => matches(r, args.where))
      return rows.length ? { season: Math.max(...rows.map((r) => Number(r.season))) } : null
    },
    findMany: async (args: { where?: Record<string, unknown> }) => h.snapshots.filter((r) => matches(r, args.where)),
  },
  playerIdentityMap: {
    findMany: async (args: { where?: Record<string, unknown> }) =>
      h.identity.filter((r) => matches(r as unknown as Record<string, unknown>, args.where)),
  },
  /* ── What the pre-fix loader reads for EVERY league: the NFL. ─────────────────────────────── */
  playerGameStat: {
    aggregate: async (args: { where?: { season?: unknown } }) =>
      args?.where?.season ? { _max: { weekOrRound: 4 } } : { _max: { season: 2026 } },
    findMany: async () => [{ playerId: 'nfl-1' }],
  },
  sportsPlayer: {
    findMany: async () => [{ sleeperId: 'nfl-1', name: 'NFL Interloper', team: 'KC', position: 'WR', updatedAt: new Date() }],
  },
}

/*
 * The NFL feed, keyed by Sleeper id. 'c1' is a college Rolling Insights number that ALSO happens to
 * be a Sleeper id — the collision `externalIdNamespace.ts` measures by the tens of thousands.
 */
const NFL_FEED: Record<string, { name: string; rec: number }> = {
  'nfl-1': { name: 'NFL Interloper', rec: 30 },
  c1: { name: 'NFL Namesake', rec: 4 },
}
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  // The AF engine column: the carry-over arithmetic stays real, and the read finds no AF rows.
  afEngineForLeague: (await importOriginal<typeof import('@/lib/core-app/playerProjections')>()).afEngineForLeague,
  lookupAfEngineProjections: vi.fn(async () => new Map()),
  lookupProjections: vi.fn(async (ids: readonly string[]) =>
    new Map(
      ids
        .filter((id) => NFL_FEED[id])
        .map((id) => [id, { projectedPoints: NFL_FEED[id]!.rec, name: NFL_FEED[id]!.name, position: 'WR', team: 'KC', componentStats: { rec: NFL_FEED[id]!.rec } }]),
    ),
  ),
}))
vi.mock('@/lib/waivers/recentFormProjection', () => ({ projectFromRecentForm: vi.fn(async () => new Map()) }))

import { loadWaiverBoard } from '@/lib/waivers/waiverBoard'

const load = () => loadWaiverBoard({ prisma: prismaDouble as never, leagueId: 'L1', userId: 'u1' })

const NBA_SLOTS = ['C', 'PG', 'UTIL', 'BN', 'BN', 'IR']

function nbaLeague(platform = 'manual', settings: Record<string, unknown> = { roster_positions: NBA_SLOTS }) {
  return { id: 'L1', sport: 'NBA', platform, settings }
}

beforeEach(() => {
  h.league = nbaLeague()
  // Native NBA roster: Rolling Insights numbers. Starters fill C and PG; b1 sits.
  h.myRoster = { players: ['101', '102', '103'], starters: ['101', '102'] }
  h.otherRosters = [{ playerData: { players: ['201'], starters: ['201'] } }]
  h.identity = [
    ident({ id: 'pim-me-c', sport: 'NBA', rollingInsightsId: '101' }),
    ident({ id: 'pim-me-pg', sport: 'NBA', rollingInsightsId: '102' }),
    ident({ id: 'pim-me-b1', sport: 'NBA', rollingInsightsId: '103' }),
    ident({ id: 'pim-theirs', sport: 'NBA', rollingInsightsId: '201' }),
    ident({ id: 'pim-fa-c', sport: 'NBA', rollingInsightsId: '301', currentTeam: 'DEN' }),
    ident({ id: 'pim-fa-sf', sport: 'NBA', rollingInsightsId: '302', currentTeam: 'BOS' }),
    // Projected, but no Rolling Insights id: cannot be looked for on a roster, so never "free".
    ident({ id: 'pim-unprovable', sport: 'NBA', espnId: '9999' }),
    // An NFL row carrying the same RI number as one of ours: a different sport, never matched.
    ident({ id: 'pim-nfl-collision', sport: 'NFL', rollingInsightsId: '101' }),
  ]
  h.snapshots = [
    snap('pim-me-c', 'Me Centre', 'C', 30),
    snap('pim-me-pg', 'Me Guard', 'PG', 35),
    snap('pim-me-b1', 'Me Bench', 'SF', 20),
    snap('pim-theirs', 'Their Star', 'C', 50),
    snap('pim-fa-c', 'Free Centre', 'C', 42),
    snap('pim-fa-sf', 'Free Wing', 'SF', 25),
    snap('pim-unprovable', 'Unprovable Star', 'PG', 60),
    // A stale duplicate row for the free centre: the fresher row (42) wins.
    snap('pim-fa-c', 'Free Centre', 'C', 5, { computedAt: new Date('2026-01-01T00:00:00Z') }),
  ]
})

describe('loadWaiverBoard — a basketball league is priced from the basketball producer', () => {
  it('ranks basketball free agents by per-game lineup gain, never NFL players', async () => {
    const board = await load()
    expect(JSON.stringify(board)).not.toContain('NFL Interloper')
    expect(board.state).toBe('ok')
    expect(board.sport).toBe('NBA')
    expect(board.basis).toBe('season_per_game_af_default')
    expect(board.week).toBeNull()
    expect(board.season).toBe('2026')

    const names = board.candidates.map((c) => c.name)
    /*
     * Your lineup: C Me Centre 30, PG Me Guard 35, UTIL Me Bench 20 = 85 per game.
     * Free Centre (42) takes C and Me Centre slides to UTIL: 107, +22, Me Bench leaves the lineup.
     * Free Wing (25) can only take UTIL, over Me Bench (20): +5.
     */
    expect(names).toEqual(['Free Centre', 'Free Wing'])
    expect(board.currentLineupPoints).toBe(85)
    expect(board.candidates[0]).toMatchObject({ gain: 22, projectedPoints: 42, basis: 'season_rate', team: 'DEN' })
    expect(board.candidates[0]?.displaces?.name).toBe('Me Bench')
    expect(board.candidates[1]).toMatchObject({ name: 'Free Wing', gain: 5 })
  })

  it('never puts a projection key where a Sleeper id goes', async () => {
    const board = await load()
    expect(board.candidates.length).toBeGreaterThan(0)
    for (const c of board.candidates) {
      expect(c.sleeperId).toBeNull()
      expect(c.playerKey).toMatch(/^pim-/)
      if (c.displaces) expect(c.displaces.sleeperId).toBeNull()
    }
  })

  it('leaves off a player it cannot look for on the rosters, and a rostered one, and says how many', async () => {
    const board = await load()
    const names = board.candidates.map((c) => c.name)
    expect(names).not.toContain('Unprovable Star')
    expect(names).not.toContain('Their Star')
    expect(board.notes.join(' ')).toMatch(/1 projected NBA players could not be matched to this league's player ids/)
  })

  it("names the basis: a per-game season rate on AllFantasy's default scoring, not the league's rules", async () => {
    const notes = (await load()).notes.join(' ')
    expect(notes).toMatch(/Per-game points from AllFantasy's NBA season projection/)
    expect(notes).toMatch(/not each league's own rules/)
    expect(notes).toMatch(/not a projection for this week/)
  })

  it('drops a roster id the identity map ties to two different people', async () => {
    h.identity.push(ident({ id: 'pim-impostor', sport: 'NBA', rollingInsightsId: '101' }))
    h.snapshots.push(snap('pim-impostor', 'Impostor', 'C', 1))
    const board = await load()
    // Me Centre no longer resolves, so the free centre fills an EMPTY C slot: gain is his full 42.
    expect(JSON.stringify(board)).not.toContain('Impostor')
    expect(board.candidates.find((c) => c.name === 'Free Centre')?.gain).toBe(42)
  })

  it('refuses a league whose platform has no identity column (Yahoo) as unreadable', async () => {
    h.league = nbaLeague('yahoo')
    const board = await load()
    expect(board.state).toBe('ids_unreadable')
    expect(board.candidates).toEqual([])
    expect(JSON.stringify(board)).not.toContain('NFL Interloper')
  })

  it('reads an ESPN league through espnId only', async () => {
    h.league = nbaLeague('espn')
    h.myRoster = { players: ['e101', 'e102', 'e103'], starters: ['e101', 'e102'] }
    h.otherRosters = [{ playerData: { players: ['e201'], starters: ['e201'] } }]
    h.identity = h.identity.map((r) => (r.rollingInsightsId ? { ...r, espnId: `e${r.rollingInsightsId}` } : r))
    const board = await load()
    expect(board.state).toBe('ok')
    // The unprovable row's espnId (9999) is on no roster, so in an ESPN league he IS provably free.
    expect(board.candidates.map((c) => c.name)).toContain('Unprovable Star')
    expect(board.candidates.map((c) => c.name)).not.toContain('Their Star')
  })

  it('says the producer has written nothing yet, rather than showing an empty wire', async () => {
    h.snapshots = []
    const board = await load()
    expect(board.state).toBe('no_projections')
    expect(board.notes.join(' ')).toMatch(/NBA season projections have not been written yet/)
  })
})

describe('loadWaiverBoard — college football and soccer', () => {
  it('never offers a college league NFL players; prices college players under its own scoring', async () => {
    h.league = {
      id: 'L1',
      sport: 'NCAAF',
      platform: 'manual',
      settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'WR', 'FLEX', 'BN'] },
    }
    h.myRoster = { players: ['c1', 'c2'], starters: ['c1'] }
    h.otherRosters = []
    h.identity = [
      ident({ id: 'x1', sport: 'NCAAF', cfbdId: 'cf1', rollingInsightsId: 'c1' }),
      ident({ id: 'x2', sport: 'NCAAF', cfbdId: 'cf2', rollingInsightsId: 'c2' }),
      ident({ id: 'x3', sport: 'NCAAF', cfbdId: 'cf3', rollingInsightsId: 'c3', currentTeam: 'UGA' }),
    ]
    const cfb = (id: string, name: string, pos: string, rec: number) =>
      snap(id, name, pos, 99, { sport: 'NCAAF', adjustmentFactors: { perGameRates: { 'receiving.REC': rec } } })
    h.snapshots = [cfb('cf1', 'College QB', 'WR', 3), cfb('cf2', 'College Bench', 'WR', 2), cfb('cf3', 'College Free Agent', 'WR', 7)]

    const board = await load()
    expect(JSON.stringify(board)).not.toContain('NFL Interloper')
    expect(JSON.stringify(board)).not.toContain('NFL Namesake')
    expect(board.state).toBe('ok')
    expect(board.sport).toBe('NCAAF')
    expect(board.basis).toBe('season_per_game_league')
    // League-scored from the CFBD component line (7 receptions × 1), NOT the engine's generic 99.
    expect(board.candidates[0]).toMatchObject({ name: 'College Free Agent', projectedPoints: 7, team: 'UGA' })
  })

  it('shows a soccer league the honest reason there is no board', async () => {
    h.league = { id: 'L1', sport: 'SOCCER', platform: 'manual', settings: { roster_positions: ['GK', 'DF', 'MF', 'FW'] } }
    const board = await load()
    expect(JSON.stringify(board)).not.toContain('NFL Interloper')
    expect(board.state).toBe('no_producer')
    expect(board.sport).toBe('SOCCER')
    expect(board.notes.join(' ')).toMatch(/No projection exists for soccer players/)
  })
})

describe('loadWaiverBoard — the NFL path is untouched', () => {
  it('an NFL league (or one with no sport stored) still takes the NFL path', async () => {
    for (const sport of ['NFL', undefined]) {
      h.league = { id: 'L1', sport, platform: 'sleeper', settings: { scoring_settings: { rec: 1 }, roster_positions: ['WR'] } }
      h.myRoster = { players: ['c1'], starters: [] }
      const board = await load()
      expect(board.sport).toBeUndefined()
      expect(board.basis).toBeUndefined()
      expect(board.candidates.map((c) => c.name)).toContain('NFL Interloper')
    }
  })
})
