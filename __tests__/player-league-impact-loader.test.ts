// @vitest-environment node
/**
 * `getPlayerLeagueImpact` — the per-league "if he sits" loader behind the home exposure
 * card (user decisions, 2026-09-14). It reads only YOUR claimed teams, spends matchup
 * reads only where he starts, bounds that spend, and prices through the Matchup
 * screen's own steps (`loadMatchupSides` + `winProbabilityFor`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Team = { leagueId: string; platformUserId: string | null; externalId: string; claimedByUserId: string | null }
type RosterRow = { leagueId: string; platformUserId: string; playerData: unknown }
type LeagueRow = { id: string; name: string; platform: string; platformLeagueId: string | null }
type WeekRow = { leagueId: string; rosterId: string; matchupId: number | null; pointsFor: number; pointsAgainst: number }

const db = {
  teams: [] as Team[],
  rosters: [] as RosterRow[],
  leagues: [] as LeagueRow[],
  weeks: [] as WeekRow[],
  rosterQueries: [] as unknown[],
  weekQueries: [] as string[],
  failWeekFor: null as string | null,
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: {
      findMany: vi.fn(async ({ where }: { where: { claimedByUserId: string } }) =>
        db.teams.filter((t) => t.claimedByUserId === where.claimedByUserId),
      ),
      findFirst: vi.fn(async ({ where }: { where: { leagueId: string; externalId: string } }) =>
        db.teams.find((t) => t.leagueId === where.leagueId && t.externalId === where.externalId) ?? null,
      ),
    },
    roster: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        db.rosterQueries.push(where)
        const clauses = (where.OR as Array<{ leagueId: string; platformUserId: { in: string[] } }> | undefined) ?? [
          where as { leagueId: string; platformUserId: { in: string[] } },
        ]
        return db.rosters.filter((r) =>
          clauses.some((c) => c.leagueId === r.leagueId && c.platformUserId.in.includes(r.platformUserId)),
        )
      }),
    },
    league: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        db.leagues.filter((l) => where.id.in.includes(l.id)),
      ),
    },
    weeklyMatchup: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string } }) => {
        db.weekQueries.push(where.leagueId)
        if (where.leagueId === db.failWeekFor) throw new Error('read failed')
        return db.weeks.filter((w) => w.leagueId === where.leagueId)
      }),
    },
  },
}))
vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 2 })),
}))
vi.mock('@/lib/core-app/leagueHome', () => ({ leagueDisplayName: (n: string | null) => n ?? 'League' }))

const loadSideProjections = vi.fn()
vi.mock('@/lib/core-app/matchupProjections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/matchupProjections')>()),
  loadSideProjections: (...a: unknown[]) => loadSideProjections(...a),
}))

import { getPlayerLeagueImpact, MAX_PRICED_LEAGUES, slotOf } from '@/lib/core-app/playerLeagueImpact'
import { loadMatchupSides, matchupCurrentPoints } from '@/lib/core-app/matchupWinInputs'

const USER = 'user-1'
const HIM = '4046'

const starter = (playerId: string, projectedPoints: number) => ({ playerId, projectedPoints, actualPoints: 0, isFinal: false })
const side = (ids: Array<[string, number]>) => ({
  starters: ids.map(([id, p]) => starter(id, p)),
  unprojected: 0,
  projectedRemaining: ids.reduce((s, [, p]) => s + p, 0),
  lineup: ids.map(([playerId, projected]) => ({ playerId, projected })),
})

/** A league where you (roster "1") play roster "2", with `slotList` holding him. */
function addLeague(id: string, slotList: 'starters' | 'players' | 'reserve' | 'taxi', over: Partial<LeagueRow> = {}) {
  const platformLeagueId = over.platformLeagueId === undefined ? `p-${id}` : over.platformLeagueId
  db.leagues.push({ id, name: over.name ?? `League ${id}`, platform: 'sleeper', platformLeagueId })
  db.teams.push({ leagueId: id, platformUserId: `su-${id}`, externalId: '1', claimedByUserId: USER })
  db.teams.push({ leagueId: id, platformUserId: `opp-${id}`, externalId: '2', claimedByUserId: 'someone-else' })
  const playerData = { players: [HIM, 'B'], starters: slotList === 'starters' ? [HIM, 'B'] : ['B'], [slotList]: [HIM] }
  if (slotList === 'players') playerData.players = [HIM, 'B']
  db.rosters.push({ leagueId: id, platformUserId: `su-${id}`, playerData })
  db.rosters.push({ leagueId: id, platformUserId: `opp-${id}`, playerData: { starters: ['X'] } })
  if (platformLeagueId) {
    db.weeks.push({ leagueId: platformLeagueId, rosterId: '1', matchupId: 7, pointsFor: 0, pointsAgainst: 0 })
    db.weeks.push({ leagueId: platformLeagueId, rosterId: '2', matchupId: 7, pointsFor: 0, pointsAgainst: 0 })
  }
}

beforeEach(() => {
  db.teams = []
  db.rosters = []
  db.leagues = []
  db.weeks = []
  db.rosterQueries = []
  db.weekQueries = []
  db.failWeekFor = null
  loadSideProjections.mockReset()
  // Default: he is a 20-point starter in a close game.
  loadSideProjections.mockImplementation(async () => ({
    you: side([[HIM, 20], ['B', 80]]),
    opponent: side([['X', 95]]),
    leagueScoring: { available: true },
  }))
})

describe('slotOf', () => {
  it('reads starters, IR, taxi and bench from the roster lists', () => {
    expect(slotOf({ starters: [HIM], players: [HIM] }, HIM)).toBe('starter')
    expect(slotOf({ reserve: [HIM], players: [HIM] }, HIM)).toBe('ir')
    expect(slotOf({ taxi: [HIM], players: [HIM] }, HIM)).toBe('taxi')
    expect(slotOf({ players: [HIM] }, HIM)).toBe('bench')
    expect(slotOf({ players: ['B'] }, HIM)).toBeNull()
    expect(slotOf(null, HIM)).toBeNull()
  })
})

describe('getPlayerLeagueImpact', () => {
  it('🛑 prices where he starts and spends no matchup read where he does not', async () => {
    addLeague('A', 'starters')
    addLeague('B', 'players')
    addLeague('C', 'reserve')

    const out = await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: HIM })

    expect(out.rows.map((r) => [r.leagueId, r.slot, r.impact.kind])).toEqual([
      ['A', 'starter', 'priced'],
      ['B', 'bench', 'not_starting'],
      ['C', 'ir', 'not_starting'],
    ])
    expect(db.weekQueries).toEqual(['p-A'])
    const a = out.rows[0].impact
    if (a.kind !== 'priced') throw new Error('expected priced')
    expect(a.now).toBeGreaterThan(a.without)
    expect(out.notPriced).toBe(0)
  })

  it('🛑 reads only rosters keyed to YOUR claimed teams', async () => {
    addLeague('A', 'starters')
    await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: HIM })
    const exposureQuery = db.rosterQueries[0] as { OR: Array<{ leagueId: string; platformUserId: { in: string[] } }> }
    expect(exposureQuery.OR).toEqual([{ leagueId: 'A', platformUserId: { in: ['su-A', '1', USER] } }])
  })

  it('a player on none of your rosters is an empty breakdown, not an error', async () => {
    addLeague('A', 'starters')
    const out = await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: 'nobody' })
    expect(out).toEqual({ playerId: 'nobody', rows: [], notPriced: 0 })
    expect(db.weekQueries).toEqual([])
  })

  it(`🛑 prices at most ${MAX_PRICED_LEAGUES} leagues and counts the rest`, async () => {
    for (let i = 0; i < MAX_PRICED_LEAGUES + 2; i++) addLeague(`L${String(i).padStart(2, '0')}`, 'starters')
    const out = await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: HIM })
    expect(out.rows).toHaveLength(MAX_PRICED_LEAGUES)
    expect(out.notPriced).toBe(2)
    expect(db.weekQueries).toHaveLength(MAX_PRICED_LEAGUES)
  })

  it('sorts starters by the size of the drop', async () => {
    addLeague('A', 'starters', { name: 'Aardvark' })
    addLeague('Z', 'starters', { name: 'Zebra' })
    loadSideProjections.mockImplementation(async (args: { leagueId: string }) => ({
      // In Zebra he is most of the lineup, so losing him costs more.
      you: args.leagueId === 'Z' ? side([[HIM, 60], ['B', 40]]) : side([[HIM, 5], ['B', 95]]),
      opponent: side([['X', 98]]),
      leagueScoring: { available: true },
    }))
    const out = await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: HIM })
    expect(out.rows.map((r) => r.leagueId)).toEqual(['Z', 'A'])
  })

  it('a league without a platform id says why instead of pricing', async () => {
    addLeague('A', 'starters', { platformLeagueId: null })
    const out = await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: HIM })
    expect(out.rows[0].impact).toEqual({
      kind: 'no_matchup',
      reason: 'this league has no platform id, so its weekly results cannot be located',
    })
  })

  it('the model’s own refusal is passed through as unpriced', async () => {
    addLeague('A', 'starters')
    loadSideProjections.mockImplementation(async () => ({
      you: { ...side([['B', 80]]), unprojected: 1, lineup: [{ playerId: HIM, projected: null }, { playerId: 'B', projected: 80 }] },
      opponent: side([['X', 95]]),
      leagueScoring: { available: true },
    }))
    const out = await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: HIM })
    expect(out.rows[0].impact.kind).toBe('unpriced')
  })

  it('one league failing to read does not blank the others', async () => {
    addLeague('A', 'starters')
    addLeague('B', 'starters')
    db.failWeekFor = 'p-A'
    const out = await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: HIM })
    const byId = Object.fromEntries(out.rows.map((r) => [r.leagueId, r.impact.kind]))
    expect(byId).toEqual({ A: 'no_matchup', B: 'priced' })
  })
})

describe('matchupCurrentPoints', () => {
  it('🛑 your points are yours and the paired row is the opponent’s', () => {
    expect(matchupCurrentPoints({ pointsFor: 61, pointsAgainst: 12 }, { pointsFor: 44 })).toEqual({ you: 61, opponent: 44 })
  })

  it('without a paired row, your pointsAgainst stands in for the opponent', () => {
    expect(matchupCurrentPoints({ pointsFor: 61, pointsAgainst: 12 }, undefined)).toEqual({ you: 61, opponent: 12 })
  })

  it('🛑 points already banked move the price: a lead mid-game raises your chance', async () => {
    addLeague('A', 'starters')
    loadSideProjections.mockImplementation(async () => ({
      you: side([[HIM, 10], ['B', 10]]),
      opponent: side([['X', 20]]),
      leagueScoring: { available: true },
    }))
    const level = await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: HIM })
    db.weeks.find((w) => w.rosterId === '1')!.pointsFor = 40
    const ahead = await getPlayerLeagueImpact({ userId: USER, rosterPlayerId: HIM })
    const now = (r: typeof level) => (r.rows[0].impact.kind === 'priced' ? r.rows[0].impact.now : NaN)
    expect(now(ahead)).toBeGreaterThan(now(level))
  })
})

describe('loadMatchupSides', () => {
  it('🛑 the opponent never resolves to the roster key you took', async () => {
    // Your externalId "2" is also the opponent's roster id, and only a roster keyed "2" exists
    // for you — without the guard both sides would land on it.
    db.rosters.push({ leagueId: 'A', platformUserId: '2', playerData: { starters: [HIM] } })
    const out = await loadMatchupSides({
      leagueId: 'A',
      season: 2026,
      week: 2,
      userId: USER,
      you: { platformUserId: null, externalId: '2' },
      opponent: { platformUserId: null, rosterId: '2' },
    })
    expect(out).toBeNull()
    expect(loadSideProjections).not.toHaveBeenCalled()
  })

  it('passes the ACTUAL matching roster keys on', async () => {
    db.rosters.push({ leagueId: 'A', platformUserId: USER, playerData: {} })
    db.rosters.push({ leagueId: 'A', platformUserId: 'opp-A', playerData: {} })
    await loadMatchupSides({
      leagueId: 'A',
      season: 2026,
      week: 2,
      userId: USER,
      you: { platformUserId: 'not-on-a-roster', externalId: '1' },
      opponent: { platformUserId: 'opp-A', rosterId: '2' },
    })
    expect(loadSideProjections).toHaveBeenCalledWith({
      leagueId: 'A',
      season: 2026,
      week: 2,
      yourPlatformUserId: USER,
      opponentPlatformUserId: 'opp-A',
    })
  })

  it('no paired opponent means no sides', async () => {
    db.rosters.push({ leagueId: 'A', platformUserId: USER, playerData: {} })
    const out = await loadMatchupSides({
      leagueId: 'A',
      season: 2026,
      week: 2,
      userId: USER,
      you: { platformUserId: null, externalId: '1' },
      opponent: null,
    })
    expect(out).toBeNull()
  })
})
