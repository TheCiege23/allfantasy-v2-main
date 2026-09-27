/**
 * The team-benefit loader: what it reads for one league and one deal, and how it refuses.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { fantasyFinalWeek, loadTeamBenefit, type TeamBenefitDeps } from '@/lib/decision-os/trade/teamBenefitContext'
import type { TradeSide } from '@/lib/decision-os/trade/tradeRecord'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

const world = (over: Record<string, unknown> = {}) =>
  ({
    league: {
      leagueId: 'L1', sport: 'NFL', season: 2026, isDynasty: false,
      scoringSettings: { rec: 0.5, rush_yd: 0.1 },
      rosterSettings: { rosterSize: 4, starterSlots: ['RB', 'FLEX', 'BN', 'BN', 'IR'], irSlots: 1, taxiSlots: 0 },
      ...over,
    },
    teams: [],
    rosters: [
      { rosterId: 'r1', teamId: 't1', playerIds: ['a', 'b', 'hurt'], reserveIds: ['hurt'], taxiIds: [] },
      { rosterId: 'r2', teamId: 't2', playerIds: ['c'], reserveIds: [], taxiIds: [] },
    ],
  }) as unknown as CanonicalWorld

const side = (teamId: string, rosterId: string, ids: string[]): TradeSide => ({
  teamId, rosterId, gives: ids.map((id) => ({ kind: 'player' as const, playerId: id, name: id, position: 'RB' })),
})

const proj = (id: string, rush: number) => [id, { playerId: id, projectedPoints: 0, name: id.toUpperCase(), position: 'RB', team: 'BUF', componentStats: { rush_yd: rush } }] as const

const deps = (over: Partial<TeamBenefitDeps> = {}): Partial<TeamBenefitDeps> => ({
  latestWeek: { latestWeek: async () => ({ season: '2026', week: 13 }) },
  leagueSettings: async () => ({ settings: { playoff_week_start: 15, playoff_teams: 4 }, season: 2026 }),
  freeAgents: async () => [{ id: 'fa', name: 'FA', position: 'RB', team: 'MIA' }],
  projections: (async () => new Map([proj('a', 100), proj('b', 80), proj('c', 150), proj('fa', 60), proj('hurt', 90)])) as never,
  injuries: async () => new Map([['hurt', { status: 'IR', team: 'BUF' }]]),
  byes: async () => new Map([['BUF', 14]]),
  market: vi.fn(async () => new Map([['a', 3000], ['c', 6000]])),
  ...over,
})

describe('fantasyFinalWeek — the horizon comes from the league', () => {
  it.each([
    [{ playoff_week_start: 15, playoff_teams: 6 }, { finalWeek: 17, playoffStart: 15 }], // 3 rounds
    [{ playoff_week_start: 14, playoff_teams: 4 }, { finalWeek: 15, playoffStart: 14 }], // 2 rounds
    [{ playoff_week_start: 0, regular_season_length: 14, playoff_teams: 4 }, { finalWeek: 16, playoffStart: 15 }], // 0 is a sentinel
    [{}, { finalWeek: 17, playoffStart: null }],
  ])('%j → %j', (settings, want) => {
    expect(fantasyFinalWeek(settings)).toEqual(want)
  })
})

describe('loadTeamBenefit', () => {
  it('prices a deal: league-scored per-game rates, byes from the schedule, the league’s market format', async () => {
    const d = deps()
    const r = await loadTeamBenefit({ world: world(), me: side('r1', 'r1', ['a']), them: side('r2', 'r2', ['c']) }, d)
    if (!r.ok) throw new Error(r.reason)
    expect(r.benefit.horizon).toMatchObject({ currentWeek: 13, finalWeek: 16, playoffStartWeek: 15 })
    const got = r.benefit.sides[0].receives[0]!
    expect(got).toMatchObject({ playerId: 'c', byeInPlayoffs: false }) // BUF bye is week 14, not a playoff week
    // Half-PPR, one QB, two teams, redraft — read from the league, not assumed.
    expect(d.market).toHaveBeenCalledWith({ isDynasty: false, numQbs: 1, numTeams: 2, ppr: 0.5 })
  })

  it('refuses a non-NFL league with the same words the weekly basis uses', async () => {
    const r = await loadTeamBenefit({ world: world({ sport: 'NBA' }), me: side('r1', 'r1', ['a']), them: side('r2', 'r2', ['c']) }, deps())
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/NFL leagues only/) })
  })

  it('refuses a league with a starting slot the solver does not recognise — never solves a smaller lineup', async () => {
    const r = await loadTeamBenefit({
      world: world({ rosterSettings: { rosterSize: 4, starterSlots: ['RB', 'MYSTERY_SLOT', 'BN'], irSlots: 0, taxiSlots: 0 } }),
      me: side('r1', 'r1', ['a']),
      them: side('r2', 'r2', ['c']),
    }, deps())
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/does not recognise/) })
  })

  it('capacity counts starters + bench, never IR; a player on IR does not count against it', async () => {
    // Slots RB, FLEX, BN, BN (+IR) → capacity 4. r1 active = a, b (hurt is on IR). Receives c for a → 2 ≤ 4.
    const r = await loadTeamBenefit({ world: world(), me: side('r1', 'r1', ['a']), them: side('r2', 'r2', ['c']) }, deps())
    if (!r.ok) throw new Error(r.reason)
    expect(r.benefit.sides[0].forcedDrops).toEqual([])
  })

  it('both rosters must be known', async () => {
    const r = await loadTeamBenefit({ world: world(), me: { ...side('r1', 'r1', ['a']), rosterId: null }, them: side('r2', 'r2', ['c']) }, deps())
    expect(r).toMatchObject({ ok: false })
  })
})
