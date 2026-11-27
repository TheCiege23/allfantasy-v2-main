// @vitest-environment node
/**
 * The Season Outlook's focus league — a PASTED Yahoo league (lib/core-app/declaredAvailability.ts).
 *
 * Matched players are stored `sleeper:<id>`, the unmatched as `yahoo-paste:<name>|<pos>|<team>`. The
 * roster translation keeps the declared ids and drops the rest, so below the 80% coverage bar every team
 * would read short and each unmatched player would be offered as a waiver add: refused, with the count.
 * Above it the model is built, the unmatched player's own row is kept out of the free agents, and the
 * count travels as a note.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ rosters: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: {
      findMany: vi.fn(async () => [
        { externalId: 't1', platformUserId: 'u1', claimedByUserId: 'me', teamName: 'One', ownerName: 'A' },
        { externalId: 't2', platformUserId: 'u2', claimedByUserId: null, teamName: 'Two', ownerName: 'B' },
      ]),
    },
    roster: { findMany: vi.fn(async () => h.rosters) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    fantasyProjection: {
      findMany: vi.fn(async () => [
        { playerId: 'fa1', stats: { name: 'Pasted Guy', position: 'WR', team: 'KC' } },
        { playerId: 'fa2', stats: { name: 'Free Guy', position: 'WR', team: 'NYJ' } },
      ]),
    },
  },
}))
vi.mock('@/lib/decision-os/trade/leagueWeekPricing', () => ({
  isLeagueWeekRefusal: () => false,
  leagueWeekBasis: async () => ({ week: { season: 2026, week: 3 }, scoring: {} }),
  priceLeagueWeek: async (_b: unknown, ids: string[]) => new Map(ids.map((id) => [id, { projectedPoints: 10, position: 'WR' }])),
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  injuryCoverageFor: () => ({ covered: false, reason: 'no feed in this test' }),
  resolveInjuryFacts: async () => null,
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: async () => null }))
vi.mock('@/lib/core-app/byeWeeks', () => ({ getByeWeeks: async () => new Map() }))

import { loadScenarioModel } from '@/lib/core-app/seasonOutlookFocus'
import type { SimInput } from '@/lib/core-app/outlookSim'

const SIM: SimInput = {
  teams: ['t1', 't2'].map((rosterId, i) => ({ rosterId, wins: 1, losses: 1, pointsFor: 200 + i, profile: { mu: 100, sigma: 15, n: 4 } })),
  remaining: [{ week: 4, a: 't1', b: 't2' }],
  playoffTeams: 2,
  byeTeams: 0,
}
const declared = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `sleeper:${prefix}${i}`)
const roster = (id: string, platformUserId: string, team: string, players: string[]) => ({
  id,
  leagueId: 'Y1',
  platformUserId,
  playerData: { source_team_id: team, source_manager_id: '', players, starters: players.slice(0, 1) },
})

const load = () =>
  loadScenarioModel({
    leagueId: 'Y1',
    userId: 'me',
    sport: 'NFL',
    platform: 'yahoo',
    settings: { roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN'] },
    youRosterId: 't1',
    sim: SIM,
    seed: 1,
    weeks: [4],
    names: new Map([['t1', 'One'], ['t2', 'Two']]),
    now: new Date('2026-11-27T12:00:00Z'),
  })

beforeEach(() => {
  // 9 of 10 declared: above the bar.
  h.rosters = [
    roster('r1', 'u1', 't1', declared('1', 5)),
    roster('r2', 'u2', 't2', [...declared('2', 4), 'yahoo-paste:pasted guy|WR|KC']),
  ]
})

describe('loadScenarioModel — a pasted Yahoo league', () => {
  it('above the bar: builds the model on the declared ids, and counts the unmatched player', async () => {
    const loaded = await load()
    expect(loaded.model.refusal).toBeNull()
    expect(loaded.model.teams.find((t) => t.rosterId === 't1')?.players).toHaveLength(5)
    expect(loaded.model.freeAgents.map((p) => p.name)).toEqual(['Free Guy'])
    expect(loaded.unmatchedNote).toBe("1 player on rosters in this league couldn't be matched to ours.")
  })

  it('🛑 the unmatched pasted player is never offered as a waiver add', async () => {
    const { model } = await load()
    expect(model.freeAgents.map((p) => p.name)).not.toContain('Pasted Guy')
  })

  it('below the bar: refused, with the count — never a short roster or a false free agent', async () => {
    h.rosters = [
      roster('r1', 'u1', 't1', declared('1', 2)),
      roster('r2', 'u2', 't2', ['yahoo-paste:pasted guy|WR|KC', 'yahoo-paste:a|RB|KC', 'yahoo-paste:b|QB|KC']),
    ]
    const { model } = await load()
    expect(model.refusal).toBe("Roster changes cannot be priced here: 3 players on its rosters couldn't be matched to ours.")
    expect(model.teams).toEqual([])
    expect(model.freeAgents).toEqual([])
  })
})
