/**
 * Chimmy on Exile Island: once a period, reserve the open real team whose best legal starting lineup
 * has scored the most lately, and claim that lineup — through the same waiver service a person uses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  exiled: [] as Array<{ userId: string; redraftRosterId: string | null }>,
  settings: {} as Record<string, unknown>,
  waivers: null as null | { week: number; roster: { team: string | null }; takenTeamIds: string[]; locked: boolean },
  games: [] as Array<{ homeTeam: string; awayTeam: string; startTime: Date }>,
  players: [] as Array<{ id: string; name: string; position: string; team: string }>,
  scores: [] as Array<{ playerId: string; stats: Record<string, number> }>,
  claims: [] as Array<{ userId: string; playerId: string; slot?: string; week: number }>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    survivorPlayer: { findMany: vi.fn(async () => h.exiled) },
    league: { findUnique: vi.fn(async () => ({ sport: 'NFL', season: 2026, settings: h.settings })) },
    gameSchedule: { findMany: vi.fn(async () => h.games) },
    player: { findMany: vi.fn(async () => h.players) },
    playerWeeklyScore: { findMany: vi.fn(async () => h.scores) },
  },
}))
vi.mock('@/lib/redraft/scoringEngine', () => ({ buildLeagueStatScorer: () => (stats: Record<string, number>) => stats.pts ?? 0 }))
vi.mock('@/lib/survivor/exileRosterService', () => ({
  getExileWaivers: vi.fn(async () => {
    if (!h.waivers) throw new Error('Exile is not active.')
    return h.waivers
  }),
  exileWeekWindow: vi.fn(async () => ({ start: new Date('2026-10-13T04:00:00Z'), end: new Date('2026-10-20T04:00:00Z') })),
  mutateExileRoster: vi.fn(async (p: { userId: string; playerId: string; slot?: string; week: number }) => {
    h.claims.push({ userId: p.userId, playerId: p.playerId, slot: p.slot, week: p.week })
    return { ok: true }
  }),
}))

import { chimmyExilePlan, type ExileCandidate } from '@/lib/survivor/chimmyExileStrategy'
import { runChimmyExileTurn } from '@/lib/survivor/chimmyExile'

const c = (id: string, position: string, team: string, recentPoints: number): ExileCandidate => ({ id, name: id, position, team, recentPoints })

describe('chimmyExilePlan', () => {
  const field = [
    c('kc-qb', 'QB', 'KC', 20), c('kc-rb', 'RB', 'KC', 10), c('kc-wr', 'WR', 'KC', 8),
    c('buf-qb', 'QB', 'BUF', 25), c('buf-rb', 'RB', 'BUF', 2), c('buf-wr', 'WR', 'BUF', 1),
  ]

  it('takes the team whose starting lineup has scored the most, anchor first', () => {
    const plan = chimmyExilePlan(field, 'NFL', {}, ['KC', 'BUF'])!
    expect(plan.team).toBe('KC')
    expect(plan.expected).toBe(38)
    expect(plan.picks[0]).toEqual({ id: 'kc-qb', slot: 'QB' })
    expect(plan.picks.map((p) => p.id)).toEqual(['kc-qb', 'kc-rb', 'kc-wr'])
  })

  it('never takes a team another exile reserved, or one with no game left', () => {
    expect(chimmyExilePlan(field, 'NFL', {}, ['KC', 'BUF'], ['KC'])!.team).toBe('BUF')
    expect(chimmyExilePlan(field, 'NFL', {}, ['BUF'])!.team).toBe('BUF')
    expect(chimmyExilePlan(field, 'NFL', {}, [])).toBeNull()
  })

  it('skips a team with no anchor to reserve it', () => {
    const noQb = [c('kc-rb', 'RB', 'KC', 50), c('buf-qb', 'QB', 'BUF', 1)]
    expect(chimmyExilePlan(noQb, 'NFL', {}, ['KC', 'BUF'])!.team).toBe('BUF')
    expect(chimmyExilePlan([c('kc-rb', 'RB', 'KC', 50)], 'NFL', {}, ['KC'])).toBeNull()
  })

  it('fills starting spots only: the bench scores nothing on Exile', () => {
    const deep = [c('qb', 'QB', 'KC', 10), ...[1, 2, 3, 4, 5].map((n) => c(`rb${n}`, 'RB', 'KC', 10 - n))]
    const plan = chimmyExilePlan(deep, 'NFL', {}, ['KC'])!
    // Two RB spots and the flex: the three best backs, never the bench.
    expect(plan.picks.map((p) => p.slot)).toEqual(['QB', 'RB', 'RB', 'FLX'])
    expect(plan.picks.map((p) => p.id)).toEqual(['qb', 'rb1', 'rb2', 'rb3'])
    expect(plan.expected).toBe(10 + 9 + 8 + 7)
  })

  it('breaks a tie on points by the fuller lineup, then by team code', () => {
    const tied = [c('a-qb', 'QB', 'ARI', 10), c('b-qb', 'QB', 'BAL', 5), c('b-k', 'K', 'BAL', 5)]
    expect(chimmyExilePlan(tied, 'NFL', {}, ['ARI', 'BAL'])!.team).toBe('BAL')
    expect(chimmyExilePlan([c('a-qb', 'QB', 'ARI', 10), c('b-qb', 'QB', 'BAL', 10)], 'NFL', {}, ['ARI', 'BAL'])!.team).toBe('ARI')
  })
})

const chimmyEntry = { since: 's', byUserId: 'c', ownerUserId: 'orphan-r9', autopilot: { style: 'win_now', since: 's', byUserId: 'c' } }

describe('runChimmyExileTurn', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  beforeEach(() => {
    h.exiled = [{ userId: 'orphan-r9', redraftRosterId: 'r9' }]
    h.settings = { af_managed_lineups: { r9: chimmyEntry } }
    h.waivers = { week: 6, roster: { team: null }, takenTeamIds: [], locked: false }
    h.games = [
      { homeTeam: 'KC', awayTeam: 'BUF', startTime: new Date('2026-10-18T17:00:00Z') },
      // Already kicked off: its teams are locked for the period.
      { homeTeam: 'DAL', awayTeam: 'NYG', startTime: new Date('2026-10-14T00:00:00Z') },
    ]
    h.players = [
      { id: 'kc-qb', name: 'KC QB', position: 'QB', team: 'KC' }, { id: 'kc-rb', name: 'KC RB', position: 'RB', team: 'KC' },
      { id: 'buf-qb', name: 'BUF QB', position: 'QB', team: 'BUF' },
      { id: 'dal-qb', name: 'DAL QB', position: 'QB', team: 'DAL' },
    ]
    h.scores = [
      { playerId: 'kc-qb', stats: { pts: 18 } }, { playerId: 'kc-qb', stats: { pts: 22 } }, { playerId: 'kc-rb', stats: { pts: 12 } },
      { playerId: 'buf-qb', stats: { pts: 26 } },
      { playerId: 'dal-qb', stats: { pts: 99 } },
    ]
    h.claims = []
  })

  it('reserves the best open team and claims its lineup, anchor first, for the current period', async () => {
    const turn = await runChimmyExileTurn('L1', now)
    // KC: QB averages 20 plus a 12-point back beats BUF's lone 26; DAL scored most but has kicked off.
    expect(turn.claimed['orphan-r9']).toEqual({ team: 'KC', expected: 32, players: 2 })
    expect(h.claims).toEqual([
      { userId: 'orphan-r9', playerId: 'kc-qb', slot: 'QB', week: 6 },
      { userId: 'orphan-r9', playerId: 'kc-rb', slot: 'RB', week: 6 },
    ])
  })

  it('leaves a castaway alone once it has a team this period, and while locked', async () => {
    h.waivers!.roster.team = 'KC'
    expect((await runChimmyExileTurn('L1', now)).skipped['orphan-r9']).toBe('already_set')
    h.waivers = { week: 6, roster: { team: null }, takenTeamIds: [], locked: true }
    expect((await runChimmyExileTurn('L1', now)).skipped['orphan-r9']).toBe('locked')
    expect(h.claims).toEqual([])
  })

  it('respects a team another exile reserved', async () => {
    h.waivers!.takenTeamIds = ['KC']
    expect((await runChimmyExileTurn('L1', now)).claimed['orphan-r9']?.team).toBe('BUF')
  })

  it('control: an exiled empty seat Chimmy does not run, or a seat that changed hands, claims nothing', async () => {
    h.settings = {}
    expect(await runChimmyExileTurn('L1', now)).toEqual({ claimed: {}, skipped: {} })
    h.settings = { af_managed_lineups: { r9: { ...chimmyEntry, ownerUserId: 'someone-else' } } }
    expect(await runChimmyExileTurn('L1', now)).toEqual({ claimed: {}, skipped: {} })
    expect(h.claims).toEqual([])
  })

  it('says why when Exile is not open', async () => {
    h.waivers = null
    expect((await runChimmyExileTurn('L1', now)).skipped['orphan-r9']).toBe('Exile is not active.')
  })
})
