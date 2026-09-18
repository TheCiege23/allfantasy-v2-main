// @vitest-environment node
/**
 * Which stored roster the Season Outlook's focus league reads for each team.
 *
 * 🛑 THE OWNER KEY STOPPED BEING THE TEAM'S OWN KEY. Since #1005 a managerless team's roster is
 * stored under `orphan-<provider>-<teamId>` and a team whose manager changed keeps its old row, so
 * a lookup that only knows manager ids finds nothing for either. Measured read-only on production
 * 2026-09-17: 210 of 4,125 teams in rostered leagues matched NOTHING, across 32 leagues.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  teams: [] as Array<Record<string, unknown>>,
  rosters: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: vi.fn(async () => h.teams) },
    roster: { findMany: vi.fn(async () => h.rosters) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    fantasyProjection: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/decision-os/trade/leagueWeekPricing', () => ({
  isLeagueWeekRefusal: () => false,
  leagueWeekBasis: async () => ({ week: { season: 2026, week: 3 }, scoring: {} }),
  priceLeagueWeek: async () => new Map(),
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  injuryCoverageFor: () => ({ covered: false, reason: 'no feed in this test' }),
  resolveInjuryFacts: async () => null,
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: async () => null }))
vi.mock('@/lib/core-app/byeWeeks', () => ({ getByeWeeks: async () => new Map() }))

import { loadScenarioModel } from '@/lib/core-app/seasonOutlookFocus'
import type { SimInput } from '@/lib/core-app/outlookSim'

const TEAM_IDS = ['t1', 't2', 't3', 't4']

const SIM: SimInput = {
  teams: TEAM_IDS.map((rosterId, i) => ({
    rosterId,
    wins: 1,
    losses: 1,
    pointsFor: 200 + i,
    profile: { mu: 100, sigma: 15, n: 4 },
  })),
  remaining: [{ week: 4, a: 't1', b: 't2' }],
  playoffTeams: 2,
  byeTeams: 0,
}

/** The league's starting slots come from settings; without them the loader refuses outright. */
const SETTINGS = { roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN'] }

function roster(id: string, platformUserId: string, players: string[], sourceTeamId: string | null) {
  return {
    id,
    leagueId: 'L1',
    platformUserId,
    playerData: {
      ...(sourceTeamId ? { source_team_id: sourceTeamId } : {}),
      source_manager_id: '',
      players,
      starters: players.slice(0, 1),
    },
  }
}

function load() {
  return loadScenarioModel({
    leagueId: 'L1',
    userId: 'me',
    sport: 'NFL',
    platform: 'sleeper',
    settings: SETTINGS,
    youRosterId: 't1',
    sim: SIM,
    seed: 1,
    weeks: [4],
    names: new Map(TEAM_IDS.map((t) => [t, `Team ${t}`])),
    now: new Date('2026-09-17T12:00:00Z'),
  })
}

const playersOf = (model: { teams: Array<{ rosterId: string; players: Array<{ id: string }> }> }, rosterId: string) =>
  model.teams.find((t) => t.rosterId === rosterId)?.players.map((p) => p.id).sort()

beforeEach(() => {
  h.teams = [
    { externalId: 't1', platformUserId: 'u1', claimedByUserId: null, teamName: 'One', ownerName: 'A' },
    /* Orphans: no manager at all, so nothing here can reach their rows by owner. */
    { externalId: 't2', platformUserId: '', claimedByUserId: null, teamName: 'Two', ownerName: null },
    { externalId: 't3', platformUserId: 'u3', claimedByUserId: null, teamName: 'Three', ownerName: 'C' },
    { externalId: 't4', platformUserId: '', claimedByUserId: null, teamName: 'Four', ownerName: null },
  ]
  h.rosters = [
    roster('r1', 'u1', ['p11', 'p12'], 't1'),
    roster('r2', 'orphan-sleeper-t2', ['p21', 'p22'], 't2'),
    /* Written before imports recorded a team id: only the owner key can find it. */
    roster('r3', 'u3', ['p31', 'p32'], null),
    /* Two rows for one team — the duplicates #1005 left in place. The fuller one is the live roster. */
    roster('r4b', 'orphan-sleeper-t4', ['p41'], 't4'),
    roster('r4a', 'import:sleeper:t4', ['p41', 'p42', 'p43'], 't4'),
  ]
})

describe('loadScenarioModel — one roster per team', () => {
  it('🛑 finds an orphan team\'s roster by its provider team id, not by an owner key it does not have', async () => {
    const { model } = await load()
    expect(model.refusal).toBeNull()
    expect(playersOf(model, 't2')).toEqual(['p21', 'p22'])
  })

  it('still matches a row that predates the team id, through the owner key', async () => {
    const { model } = await load()
    expect(playersOf(model, 't3')).toEqual(['p31', 'p32'])
  })

  it('🛑 picks the fuller row when a team has duplicates, whatever order they arrive in', async () => {
    const forward = await load()
    expect(playersOf(forward.model, 't4')).toEqual(['p41', 'p42', 'p43'])

    h.rosters = [...h.rosters].reverse()
    const reversed = await load()
    expect(playersOf(reversed.model, 't4')).toEqual(['p41', 'p42', 'p43'])
  })

  it('gives every modelled team its own roster, and never the same row twice', async () => {
    const { model } = await load()
    expect(model.teams.map((t) => t.rosterId).sort()).toEqual(TEAM_IDS)
    const ids = model.teams.flatMap((t) => t.players.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('refuses rather than guessing when the league holds no rosters at all', async () => {
    h.rosters = []
    const { model } = await load()
    expect(model.teams).toEqual([])
    expect(model.refusal).toMatch(/no rosters are synced/i)
  })
})
