// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  teamFindMany: vi.fn(),
  groupBy: vi.fn(),
  rosterFindMany: vi.fn(),
  memoryFindMany: vi.fn(),
  playerFindMany: vi.fn(),
  translate: vi.fn(),
  latest: vi.fn(),
  series: vi.fn(),
  window: vi.fn(),
  history: vi.fn(),
  injuries: vi.fn(),
  coverage: vi.fn(),
  week: vi.fn(),
  byes: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFindMany, groupBy: h.groupBy },
    roster: { findMany: h.rosterFindMany },
    aiMemory: { findMany: h.memoryFindMany },
    sportsPlayer: { findMany: h.playerFindMany },
  },
}))
vi.mock('@/lib/core-app/rosterIdSpace', () => ({ translateRostersByLeague: h.translate }))
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({ loadLatestPlayerValueSnapshots: h.latest }))
vi.mock('@/lib/player-values/playerValueHistory', async (orig) => ({
  ...(await orig<typeof import('@/lib/player-values/playerValueHistory')>()),
  loadRosterValueSeries: h.series,
  loadPlayerValueWindow: h.window,
  loadPlayerValueHistory: h.history,
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.injuries, injuryCoverageFor: h.coverage }))
vi.mock('@/lib/core-app/sportsWeek', async (orig) => ({
  ...(await orig<typeof import('@/lib/core-app/sportsWeek')>()),
  resolveSportsWeek: h.week,
}))
vi.mock('@/lib/core-app/byeWeeks', () => ({ getByeWeeks: h.byes }))

import {
  buildPortfolioInsights,
  dailyValuesOf,
  fragilePositions,
  latestCaptureDay,
  rosterSlots,
  topStack,
  upcomingByeWeeks,
  usableId,
  COACHING_PROFILE_KEY,
} from '@/lib/core-app/portfolioInsights'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

const USER = 'u1'
const NOW = new Date('2026-09-16T15:00:00Z')

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN']

function lg(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: id.toUpperCase(),
    platform: 'sleeper',
    sport: 'NFL',
    season: 2026,
    platformLeagueId: `p-${id}`,
    userId: USER,
    leagueType: 'redraft',
    isDynasty: false,
    keeperCount: 3,
    keeperCostSystem: 'round_based',
    keeperRoundPenalty: 1,
    settings: { roster_positions: SLOTS, scoring_settings: { rec: 1 } },
    leagueVariant: null,
    bestBallMode: false,
    status: 'in_season',
    lifecycleState: 'in_season',
    leagueSize: 12,
    ...over,
  }
}

function team(leagueId: string, league: ReturnType<typeof lg>, over: Record<string, unknown> = {}) {
  return {
    leagueId,
    wins: 0,
    losses: 0,
    ties: 0,
    currentRank: 3,
    platformUserId: null,
    externalId: '1',
    isCommissioner: false,
    league,
    ...over,
  }
}

const PEOPLE: Record<string, { name: string; position: string; team: string; sport?: string }> = {
  '100': { name: 'Quinn Bee', position: 'QB', team: 'KC' },
  '200': { name: 'Rhett Ay', position: 'RB', team: 'KC' },
  '300': { name: 'Wes Rex', position: 'WR', team: 'KC' },
  '400': { name: 'Tate End', position: 'TE', team: 'BUF' },
  '500': { name: 'Ray Bench', position: 'RB', team: 'MIA' },
  '600': { name: 'Ira Hurt', position: 'RB', team: 'SF' },
  '700': { name: 'Wade Two', position: 'WR', team: 'DAL' },
  '800': { name: 'Will Three', position: 'WR', team: 'NYG' },
  '900': { name: 'Ted Two', position: 'TE', team: 'LAR' },
  '1000': { name: 'Quade Backup', position: 'QB', team: 'CHI' },
  '77': { name: 'Hoop Star', position: 'PG', team: 'BOS', sport: 'NBA' },
}

function setup() {
  const L1 = lg('l1')
  const L2 = lg('l2', { platform: 'espn', leagueType: 'dynasty', isDynasty: true })
  // A second import of l1's real league by another manager — must collapse away.
  const L3 = lg('l3', { platformLeagueId: 'p-l1', userId: 'someone-else' })
  const L4 = lg('l4', { sport: 'NBA', settings: null })
  const L5 = lg('l5', { name: 'Zed' })
  const L6 = lg('l6', { name: 'Zz Predraft', status: 'pre_draft' })

  h.teamFindMany.mockResolvedValue([
    team('l2', L2, { platformUserId: null, externalId: '5' }),
    team('l1', L1, { platformUserId: 'sl-1', isCommissioner: true }),
    team('l3', L3, { platformUserId: 'sl-1' }),
    team('l4', L4, { platformUserId: 'nba-1' }),
    team('l5', L5, { platformUserId: 'sl-5' }),
    team('l6', L6, { platformUserId: 'sl-6' }),
  ])
  h.groupBy.mockResolvedValue([
    { leagueId: 'l1', _count: { _all: 4 } },
    { leagueId: 'l2', _count: { _all: 10 } },
  ])
  const mine = {
    starters: ['100', '200', '300', '400', '0'],
    players: ['100', '200', '300', '400', '500', '600', '700', '800', '900', '1000', 'name:X Y'],
    reserve: ['600'],
    taxi: [],
    source_manager_id: 'sl-1',
  }
  h.rosterFindMany.mockResolvedValue([
    // Matches the COLUMN rule (your own user id) — but it is not your roster.
    { id: 'decoy', leagueId: 'l1', platformUserId: USER, playerData: { players: ['2000'] } },
    { id: 'mine', leagueId: 'l1', platformUserId: 'resolved-other-id', playerData: mine },
    { id: 'o1', leagueId: 'l1', platformUserId: 'x', playerData: { players: Array.from({ length: 20 }, (_, i) => String(3000 + i)) } },
    { id: 'o2', leagueId: 'l1', platformUserId: 'y', playerData: { players: ['4000'] } },
    { id: 'espn-mine', leagueId: 'l2', platformUserId: USER, playerData: { players: ['100', 'espn-raw'], starters: ['100'] } },
    { id: 'l3-copy', leagueId: 'l3', platformUserId: 'z', playerData: { players: ['100'], source_manager_id: 'sl-1' } },
    { id: 'nba', leagueId: 'l4', platformUserId: 'nba-1', playerData: { players: ['77'], starters: ['77'] } },
    // Pre-draft: a matched roster row with nobody on it.
    { id: 'empty', leagueId: 'l6', platformUserId: 'sl-6', playerData: { players: [], starters: [] } },
  ])
  h.translate.mockImplementation(async (rows: unknown[]) => rows)
  h.memoryFindMany.mockResolvedValue([{ leagueId: 'l2', value: { teamArchetype: 'rebuilder' } }])
  h.playerFindMany.mockImplementation(async ({ where }: { where: { sleeperId: { in: string[] }; sport: { equals: string } } }) =>
    where.sleeperId.in
      .filter((id) => PEOPLE[id] && (PEOPLE[id].sport ?? 'NFL') === where.sport.equals)
      .map((id) => ({ sleeperId: id, sport: PEOPLE[id].sport ?? 'NFL', name: PEOPLE[id].name, position: PEOPLE[id].position, team: PEOPLE[id].team, imageUrl: null })),
  )
  h.latest.mockImplementation(async ({ sleeperIds, format, qbFormat }: { sleeperIds: Iterable<string>; format: string; qbFormat: string }) =>
    [...sleeperIds].map((id) => ({
      sleeperId: id,
      value: format === 'DYNASTY' && qbFormat === 'SUPERFLEX' ? 500 : 100,
    })),
  )
  h.window.mockResolvedValue([
    { sleeperId: '100', first: 400, firstDay: '2026-09-01', last: 500, lastDay: '2026-09-03' },
    { sleeperId: '200', first: 300, firstDay: '2026-09-03', last: 300, lastDay: '2026-09-03' },
  ])
  h.series.mockImplementation(async ({ book }: { book: { format: string } }) =>
    book.format === 'REDRAFT'
      ? [
          { leagueId: 'l1', day: '2026-09-01', total: 900, priced: 9 },
          { leagueId: 'l1', day: '2026-09-03', total: 1000, priced: 10 },
        ]
      : [{ leagueId: 'l2', day: '2026-09-03', total: 50, priced: 1 }],
  )
  h.history.mockResolvedValue([
    { sleeperId: '100', day: '2026-09-01', value: 400 },
    { sleeperId: '100', day: '2026-09-03', value: 500 },
  ])
  h.coverage.mockImplementation((sport: string) => (sport === 'NFL' ? { covered: true, reason: null } : { covered: false, reason: 'no feed' }))
  h.injuries.mockResolvedValue({
    byPlayer: new Map([
      [normalizeMatchName('Quinn Bee'), { status: 'Out', stale: false }],
      [normalizeMatchName('Wes Rex'), { status: 'Questionable', stale: false }],
      [normalizeMatchName('Tate End'), { status: 'Active', stale: false }],
      [normalizeMatchName('Ray Bench'), { status: 'Out', stale: true }],
    ]),
    ambiguous: [],
    newestFetchedAt: NOW,
    feedStale: false,
    coverage: { sourceAvailable: true, reason: null },
  })
  h.week.mockResolvedValue({ season: 2026, week: 3, seasonType: 'regular' })
  h.byes.mockResolvedValue({
    byWeek: new Map([
      [5, ['KC']],
      [6, ['BUF', 'MIA']],
    ]),
    weeksCovered: [3, 4, 5, 6, 7, 8],
    season: 2026,
  })
}

describe('buildPortfolioInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setup()
  })

  it('returns an empty board, flagged, when nothing is claimed', async () => {
    h.teamFindMany.mockResolvedValue([])
    const out = await buildPortfolioInsights(USER, NOW)
    expect(out.leagues).toEqual([])
    expect(out.notes.noClaimedTeams).toBe(true)
    expect(h.rosterFindMany).not.toHaveBeenCalled()
  })

  it('🛑 collapses a second import of the same real league, commissioner first, then by name', async () => {
    const out = await buildPortfolioInsights(USER, NOW)
    expect(out.leagues.map((l) => l.id)).toEqual(['l1', 'l2', 'l4', 'l5', 'l6'])
  })

  it('🛑 picks your roster by source_manager_id before the platformUserId column', async () => {
    const out = await buildPortfolioInsights(USER, NOW)
    const held = out.players.filter((p) => p.held.some(([i]) => i === 0)).map((p) => p.id)
    expect(held).toContain('100')
    expect(held).not.toContain('2000')
  })

  it('codes each slot and drops Sleeper’s empty-slot "0" and unresolved name: ids', async () => {
    const out = await buildPortfolioInsights(USER, NOW)
    const slotOf = (id: string) => out.players.find((p) => p.key === `NFL:${id}`)?.held.find(([i]) => i === 0)?.[1]
    expect(slotOf('100')).toBe('S')
    expect(slotOf('500')).toBe('B')
    expect(slotOf('600')).toBe('I')
    expect(out.players.some((p) => p.id === '0' || p.id.startsWith('name:'))).toBe(false)
  })

  it('keys players by sport and prices only NFL', async () => {
    const out = await buildPortfolioInsights(USER, NOW)
    const hoop = out.players.find((p) => p.key === 'NBA:77')!
    expect(hoop.value).toBeNull()
    expect(hoop.name).toBe('Hoop Star')
    const qb = out.players.find((p) => p.key === 'NFL:100')!
    expect(qb.value).toBe(500)
    expect(qb.valueDelta).toBe(100)
    expect(qb.held).toEqual([
      [0, 'S'],
      [1, 'S'],
    ])
    // A single-day window is not a move.
    expect(out.players.find((p) => p.key === 'NFL:200')!.valueDelta).toBeNull()
    expect(h.playerFindMany.mock.calls.every(([arg]) => arg.where.sport.mode === 'insensitive')).toBe(true)
  })

  it('🛑 suppresses a stale injury and treats "Active" as no designation', async () => {
    const out = await buildPortfolioInsights(USER, NOW)
    const inj = (id: string) => out.players.find((p) => p.key === `NFL:${id}`)!.injury
    expect(inj('100')).toEqual({ status: 'Out', kind: 'out' })
    expect(inj('300')).toEqual({ status: 'Questionable', kind: 'risk' })
    expect(inj('400')).toBeNull()
    expect(inj('500')).toBeNull()
    expect(out.injuryGaps).toEqual([{ sport: 'NBA', reason: 'no feed' }])
  })

  it('builds the risk facts from starters: out, questionable, upcoming byes, thin spots and the stack', async () => {
    const out = await buildPortfolioInsights(USER, NOW)
    // Weeks 3 and 4 are judged but nobody is off — they are not columns.
    expect(out.byeWeeks).toEqual([5, 6])
    expect(out.nflWeek).toEqual({ season: 2026, week: 3, preseason: false })
    const r = out.risk.find((x) => x.leagueIndex === 0)!
    expect(r.out).toEqual(['NFL:100'])
    expect(r.atRisk).toEqual(['NFL:300'])
    expect(r.byes).toEqual({ '5': ['NFL:100', 'NFL:200', 'NFL:300'], '6': ['NFL:400'] })
    // QB: backup exists but the starter is out → 1 healthy for 1 slot. RB: 600 is on IR → 2 for 2.
    expect(r.fragile!.map((f) => [f.position, f.starters, f.healthy])).toEqual([
      ['QB', 1, 1],
      ['RB', 2, 2],
    ])
    expect(r.stack).toEqual({ team: 'KC', players: ['NFL:100', 'NFL:200', 'NFL:300'] })
    expect(out.risk.some((x) => x.leagueIndex === 2)).toBe(false)
    expect(out.players.find((p) => p.key === 'NFL:100')!.byeWeek).toBe(5)
  })

  it('🛑 ranks your roster value against every roster in the league, and states the status source', async () => {
    const out = await buildPortfolioInsights(USER, NOW)
    const l1 = out.leagues[0]
    expect(l1.rosterValue).toBe(1000)
    expect(l1.rosterValueRank).toBe(2)
    expect(l1.valuedTeams).toBe(4)
    expect(l1.status).toBe('contender')
    expect(l1.statusSource).toBe('roster_value')
    expect(l1.record).toBeNull()
    expect(l1.rank).toBeNull()
    expect(l1.valueBook).toBe('redraft · 1QB')
    expect(l1.commissioner).toBe(true)
    const l2 = out.leagues[1]
    expect(l2).toMatchObject({ platform: 'espn', family: 'dynasty', status: 'rebuild', statusSource: 'you', valueBook: 'dynasty · 1QB' })
    const l5 = out.leagues[3]
    expect(l5.hasRoster).toBe(false)
    expect(l5.rosterValue).toBeNull()
    // 🛑 A matched roster with no players is not readable — it would dilute every exposure share.
    const l6 = out.leagues[4]
    expect(l6.hasRoster).toBe(false)
    expect(l6.stage).toBe('pre_draft')
    expect(out.risk.some((x) => x.leagueIndex === 4)).toBe(false)
    expect(out.notes.rostersMissing).toBe(2)
  })

  it('aligns every league’s series to one date axis and keeps a gap as a gap', async () => {
    const out = await buildPortfolioInsights(USER, NOW)
    expect(out.valueDates).toEqual(['2026-09-01', '2026-09-03'])
    expect(out.valueSeries).toEqual([
      { leagueIndex: 0, values: [900, 1000], priced: [9, 10], rosterSize: 10 },
      { leagueIndex: 1, values: [null, 50], priced: [null, 1], rosterSize: 2 },
    ])
    expect(out.movers).toEqual([{ key: 'NFL:100', values: [400, 500] }])
    expect(latestCaptureDay(out)).toBe('2026-09-03')
    expect(dailyValuesOf(out)).toEqual({ l1: 1000, l2: 50 })
  })

  it('translates ESPN rosters once, keyed by league platform', async () => {
    await buildPortfolioInsights(USER, NOW)
    expect(h.translate).toHaveBeenCalledTimes(1)
    const byLeague = h.translate.mock.calls[0][1] as Map<string, string>
    expect(byLeague.get('l2')).toBe('espn')
  })

  it('has no byes and no week when the schedule cannot answer', async () => {
    h.week.mockResolvedValue(null)
    const out = await buildPortfolioInsights(USER, NOW)
    expect(out.nflWeek).toBeNull()
    expect(out.byeWeeks).toEqual([])
    expect(h.byes).not.toHaveBeenCalled()
  })
})

describe('pure helpers', () => {
  it('usableId drops empty-slot markers and unresolved names', () => {
    expect(['123', '0', '', 'null', 'name:A B:QB:KC'].map(usableId)).toEqual([true, false, false, false, false])
  })

  it('rosterSlots: a starter the players list omits is still in the lineup; object entries are read', () => {
    const slots = rosterSlots({ players: [{ playerId: '9' }, '8'], starters: ['7', '9'], ir: ['8'] })
    expect([...slots.entries()].sort()).toEqual([
      ['7', 'S'],
      ['8', 'I'],
      ['9', 'S'],
    ])
  })

  it('fragilePositions: unknown slots are null, flex and K/DEF are never flagged', () => {
    expect(fragilePositions(null, new Map(), () => null, () => false)).toBeNull()
    const roster = new Map([['k', 'S' as const]])
    expect(fragilePositions(['K', 'DEF', 'FLEX'], roster, () => 'K', () => false)).toEqual([])
    // A detailed IDP position fills its slot through the slot rule; an empty slot type is thin.
    expect(fragilePositions(['DL', 'DB'], new Map([['d', 'S' as const]]), () => 'DT', () => false)).toEqual([
      { position: 'DB', starters: 1, healthy: 0, players: [] },
      { position: 'DL', starters: 1, healthy: 1, players: ['d'] },
    ])
    // A fullback is running-back depth.
    expect(fragilePositions(['RB'], new Map([['a', 'S' as const], ['b', 'B' as const]]), (id) => (id === 'a' ? 'RB' : 'FB'), () => false)).toEqual([])
  })

  it('topStack needs two from one club and breaks ties alphabetically', () => {
    const team: Record<string, string> = { a: 'NYJ', b: 'NYJ', c: 'BAL', d: 'BAL', e: 'KC' }
    expect(topStack(['a', 'b', 'c', 'd', 'e'], (id) => team[id])).toEqual({ team: 'BAL', players: ['c', 'd'] })
    expect(topStack(['a', 'e'], (id) => team[id])).toBeNull()
  })

  it('upcomingByeWeeks starts at week 1 in the preseason and only uses candidate weeks', () => {
    expect(upcomingByeWeeks({ week: 3, preseason: true }, [1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4])
    expect(upcomingByeWeeks({ week: 16, preseason: false }, [15, 16, 18])).toEqual([16, 18])
    expect(upcomingByeWeeks(null, [1, 2])).toEqual([])
  })

  it('🛑 reads the coaching-profile key Chimmy writes', () => {
    const src = readFileSync(path.join(process.cwd(), 'lib/chimmy-personalization/remembered.ts'), 'utf8')
    expect(src).toContain(`export const COACHING_PROFILE_KEY = '${COACHING_PROFILE_KEY}'`)
    expect(src).toMatch(/teamArchetype/)
  })
})

describe('import graph', () => {
  it('🛑 never reaches lib/auth or a provider client — the cron imports this module', () => {
    const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
    for (const file of ['lib/core-app/portfolioInsights.ts', 'lib/core-app/portfolioInsightsSummary.ts', 'lib/core-app/portfolioClassify.ts']) {
      const src = read(file)
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])
      expect(imports.filter((i) => /lib\/auth|next-auth|leagueHome|sleeper-client|fantasycalc|api-sports/.test(i))).toEqual([])
      expect(src).not.toMatch(/\bfetch\(/)
    }
  })
})
