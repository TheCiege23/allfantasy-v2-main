// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  matchups: [] as Array<Record<string, unknown>>,
  facts: [] as Array<Record<string, unknown>>,
  teams: [] as Array<Record<string, unknown>>,
  cache: new Map<string, unknown>(),
  upsert: vi.fn(),
  focus: vi.fn(),
  leagueMetadata: {} as Record<string, unknown>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: vi.fn(async () => h.matchups) },
    matchupFact: { findMany: vi.fn(async () => h.facts) },
    leagueTeam: {
      findMany: vi.fn(async (args: { where: { claimedByUserId?: string } }) =>
        args.where.claimedByUserId
          ? h.teams.filter((t) => t.claimedByUserId === args.where.claimedByUserId)
          : h.teams,
      ),
    },
    league: { findMany: vi.fn(async () => [{ id: 'L1', sport: 'NFL', ...h.leagueMetadata }]) },
    sportsDataCache: {
      findMany: vi.fn(async (args: { where: { cacheKey: { in: string[] } } }) =>
        args.where.cacheKey.in.filter((k) => h.cache.has(k)).map((k) => ({ cacheKey: k, data: h.cache.get(k) })),
      ),
      upsert: h.upsert,
    },
  },
}))
vi.mock('@/lib/core-app/seasonPhase', () => ({ getFirstStatedKickoff: async () => null }))
vi.mock('@/lib/core-app/seasonOutlookFocus', () => ({
  BRANCH_ITERATIONS: 400,
  loadScenarioModel: h.focus,
  buildFocusInsights: () => ({ drivers: [], moves: [], durability: null, branchIterations: 400, notes: [] }),
}))

const { getSeasonOutlook } = await import('@/lib/core-app/seasonOutlook')
const { leagueSimCacheKey } = await import('@/lib/core-app/seasonOutlookSims')

const PID = 'sl-1'
const IDS = ['1', '2', '3', '4', '5', '6', '7', '8']

/** Three completed weeks and three to play, plus a paired playoff week that must NOT count. */
function seed() {
  h.matchups = []
  const pairs = [
    ['1', '8'],
    ['2', '7'],
    ['3', '6'],
    ['4', '5'],
  ]
  for (let week = 1; week <= 7; week += 1) {
    pairs.forEach(([a, b], m) => {
      const played = week <= 3
      const sa = played ? 100 + Number(a) * 3 + week : 0
      const sb = played ? 100 + Number(b) * 3 : 0
      for (const [id, pf, pa] of [
        [a, sa, sb],
        [b, sb, sa],
      ] as const) {
        h.matchups.push({
          leagueId: PID,
          seasonYear: 2026,
          week,
          rosterId: id,
          matchupId: m + 1,
          pointsFor: pf,
          pointsAgainst: pa,
          win: played && pf > pa ? 1 : 0,
        })
      }
    })
  }
  h.teams = IDS.map((id) => ({
    externalId: id,
    teamName: `Team ${id}`,
    ownerName: null,
    claimedByUserId: id === '5' ? 'me' : null,
    league: { platformLeagueId: PID },
  }))
  h.facts = []
}

const LEAGUE = {
  id: 'L1',
  name: 'Test League',
  platform: 'sleeper',
  platformLeagueId: PID,
  settings: { playoff_teams: 4, playoffSettings: { playoffStartWeek: 7 } },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.cache.clear()
  h.leagueMetadata = {}
  h.upsert.mockImplementation(async (args: { create: { cacheKey: string; data: unknown } }) => {
    h.cache.set(args.create.cacheKey, args.create.data)
    return {}
  })
  h.focus.mockResolvedValue(null)
  seed()
})

describe('getSeasonOutlook', () => {
  it('keeps a partially scored current week in the remaining schedule', async () => {
    h.leagueMetadata = { season: 2026, settings: { leg: 4 } }
    for (const r of h.matchups) {
      if (r.week === 4) { r.pointsFor = 29; r.pointsAgainst = 47; r.win = 0 }
    }
    const out = await getSeasonOutlook('me', [LEAGUE])
    expect(out.leagues[0].you!.schedule?.pastGames).toBe(3)
    expect(out.leagues[0].weeksRemaining).toBe(3)
    expect(out.leagues[0].assumptions.remainingGames).toBe(12)
  })
  it('uses the league-stated field and stops the schedule at the last regular week', async () => {
    const out = await getSeasonOutlook('me', [LEAGUE])
    const l = out.leagues[0]
    expect(l.playoffTeams).toBe(4)
    expect(l.assumptions.playoffTeams.source).toBe('league')
    expect(l.byeTeams).toBe(0)
    expect(l.assumptions.regularSeasonEndWeek).toBe(6)
    // Weeks 4-6 remain; week 7 is a playoff week even though the platform paired it.
    expect(l.weeksRemaining).toBe(3)
    expect(l.assumptions.remainingGames).toBe(12)
  })

  it('identifies you, gives ranges, milestones and a condition that names a win total', async () => {
    const out = await getSeasonOutlook('me', [LEAGUE])
    const you = out.leagues[0].you!
    expect(you.rosterId).toBe('5')
    expect(you.range).not.toBeNull()
    expect(you.range!.playoff.lo).toBeLessThanOrEqual(you.playoffPct)
    expect(you.range!.playoff.hi).toBeGreaterThanOrEqual(you.playoffPct)
    expect(you.missPct).toBeCloseTo(100 - you.playoffPct)
    expect(out.leagues[0].milestones?.totalGames).toBe(6)
    expect(you.schedule?.pastGames).toBe(3)
    expect(you.schedule?.remainingGames).toBe(3)
    expect(you.expectedWins).not.toBeNull()
  })

  it('🛑 stores each league run and reuses it while the inputs are unchanged', async () => {
    const first = await getSeasonOutlook('me', [LEAGUE])
    expect(first.runs).toEqual({ reused: 0, computed: 1 })
    expect(h.cache.has(leagueSimCacheKey(PID))).toBe(true)

    const second = await getSeasonOutlook('me', [LEAGUE])
    expect(second.runs).toEqual({ reused: 1, computed: 0 })
    expect(second.leagues[0].assumptions.reused).toBe(true)
    // Same inputs, same numbers — reuse cannot change what the page says.
    expect(second.leagues[0].you!.playoffPct).toBe(first.leagues[0].you!.playoffPct)
  })

  it('🛑 re-runs a league once a week is scored', async () => {
    await getSeasonOutlook('me', [LEAGUE])
    for (const r of h.matchups) {
      if (r.week !== 4) continue
      r.pointsFor = 100 + Number(r.rosterId)
      r.pointsAgainst = 90
      r.win = Number(r.rosterId) % 2
    }
    const after = await getSeasonOutlook('me', [LEAGUE])
    expect(after.runs).toEqual({ reused: 0, computed: 1 })
    expect(after.leagues[0].weeksRemaining).toBe(2)
  })

  it('only builds the roster focus for the league on screen', async () => {
    await getSeasonOutlook('me', [LEAGUE])
    expect(h.focus).not.toHaveBeenCalled()
    await getSeasonOutlook('me', [LEAGUE], 'L1')
    expect(h.focus).toHaveBeenCalledTimes(1)
  })

  it('withholds a league with too few modelled teams, and says why', async () => {
    h.matchups = h.matchups.filter((r) => (r.week as number) > 3)
    const out = await getSeasonOutlook('me', [LEAGUE])
    expect(out.leagues).toEqual([])
    expect(out.withheld[0].reason).toMatch(/three or more completed weeks/)
  })
})
