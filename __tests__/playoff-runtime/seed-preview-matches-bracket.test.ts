/**
 * The playoff seed preview is the bracket's own seeding (lib/playoff-runtime/playoffSeedPreview.ts).
 *
 * `/scoring/playoff-seeds` used to rank `FantasyStanding` by its own rule and ignore native divisions,
 * so with "division winners take the top seeds" on, a division winner with the 4th-best record showed
 * as the 4 seed in the preview and entered the bracket as the 2. These pin preview == bracket, with
 * divisions on, before and after the bracket is generated, and that `computePlayoffSeeds` stores them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  season: null as Record<string, unknown> | null,
  generic: [] as Array<{ id: string; platformUserId: string | null; redraftRosterId: string | null }>,
  standings: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ where: any; data: any }>,
  cleared: [] as Array<{ where: any; data: any }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: vi.fn(async () => h.season) },
    redraftMatchup: { findMany: vi.fn(async () => []) },
    roster: { findMany: vi.fn(async () => h.generic) },
    league: { findUnique: vi.fn(async () => ({ settings: {} })) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    fantasyStanding: {
      findMany: vi.fn(async () => h.standings),
      update: vi.fn(async (args: { where: any; data: any }) => {
        h.updates.push(args)
        return {}
      }),
      updateMany: vi.fn(async (args: { where: any; data: any }) => {
        h.cleared.push(args)
        return { count: 0 }
      }),
    },
  },
}))
vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules: vi.fn(async () => RULES) }))

import {
  buildNflRedraftPlayoffRuntimeState,
  currentNflRedraftPlayoffSeeds,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRulesInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { applyDivisionsToTeams } from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import { loadNativePlayoffSeedPreview } from '@/lib/playoff-runtime/playoffSeedPreview'
import type { SeasonRosterDivisions } from '@/lib/league/divisions/loadLeagueDivisions'

const RULES: NflRedraftPlayoffRulesInput = {
  general: { season: 2026, sport: 'NFL', teamCount: 8 },
  playoffs: { teamCount: 4, startWeek: 15, seedingRules: 'standard_standings', standingsTiebreakers: ['points_for'] },
  schedule: { regularSeasonLength: 14 },
}

/*
 * Eight season rosters, best record first. East holds the four best records; West's best (sp-west-1)
 * is 5th overall. With "top seeds" the West winner is seed 2; by record alone it would miss the field.
 */
const ROSTERS = [
  { id: 'sp-east-1', wins: 12 },
  { id: 'sp-east-2', wins: 11 },
  { id: 'sp-east-3', wins: 10 },
  { id: 'sp-east-4', wins: 9 },
  { id: 'sp-west-1', wins: 8 },
  { id: 'sp-west-2', wins: 7 },
  { id: 'sp-west-3', wins: 6 },
  { id: 'sp-west-4', wins: 5 },
].map((r, i) => ({
  id: r.id,
  ownerId: `owner-${r.id}`,
  ownerName: `Owner ${i + 1}`,
  teamName: `Team ${r.id}`,
  wins: r.wins,
  losses: 14 - r.wins,
  ties: 0,
  pointsFor: 1500 - i * 10,
  pointsAgainst: 1300,
  playoffSeed: null,
  isEliminated: false,
}))

const EAST = { key: 'div-east', index: 0, name: 'East' }
const WEST = { key: 'div-west', index: 1, name: 'West' }
const DIVISIONS: SeasonRosterDivisions = {
  playoffRule: 'top_seeds',
  divisions: [EAST, WEST],
  byRoster: new Map(ROSTERS.map((r) => [r.id, r.id.includes('east') ? EAST : WEST])),
}
const deps = {
  loadRules: async () => RULES as never,
  loadRegularSeasonMatchups: async () => [],
  loadDivisions: async () => DIVISIONS,
}

function seasonRow(extra: Record<string, unknown> = {}) {
  return {
    id: 'season-sp-1',
    leagueId: 'league-sp-1',
    sport: 'NFL',
    season: 2026,
    currentWeek: 14,
    status: 'active',
    playoffStartWeek: 15,
    rosters: ROSTERS,
    playoffBracket: null,
    playoffRounds: [],
    ...extra,
  }
}

/** What the bracket generator itself seeds, from the same rosters and divisions. */
function bracketSeeds() {
  const state = buildNflRedraftPlayoffRuntimeState({
    leagueId: 'league-sp-1',
    seasonId: 'season-sp-1',
    season: 2026,
    week: 15,
    rules: { ...RULES, playoffs: { ...RULES.playoffs, divisionPlayoffRule: 'top_seeds' } },
    teams: applyDivisionsToTeams(
      ROSTERS.map((r) => ({ rosterId: r.id, displayName: r.teamName, wins: r.wins, losses: r.losses, ties: 0, pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst })),
      DIVISIONS,
      [],
    ),
  })
  const generated = generateNflRedraftPlayoffBracket({ state })
  const seeds = new Map<string, number>()
  for (const m of generated.bracket.rounds[0]!.matchups) {
    if (m.homeRosterId && m.homeSeed != null) seeds.set(m.homeRosterId, m.homeSeed)
    if (m.awayRosterId && m.awaySeed != null) seeds.set(m.awayRosterId, m.awaySeed)
  }
  return { state, generated, seeds: [...seeds].sort((a, b) => a[1] - b[1]) }
}

beforeEach(() => {
  h.season = seasonRow()
  // Generic rosters with ids distinct from the season roster ids; one links by owner only.
  h.generic = ROSTERS.map((r, i) => ({
    id: `generic-${r.id}`,
    platformUserId: r.ownerId,
    redraftRosterId: i === 0 ? null : r.id,
  }))
  h.standings = ROSTERS.map((r) => ({ rosterId: `generic-${r.id}`, wins: r.wins, pointsFor: r.pointsFor }))
  h.updates = []
  h.cleared = []
})

describe('seed preview == bracket seeding, divisions on', () => {
  it('the preview gives the West winner seed 2, exactly as the generated bracket does', async () => {
    const preview = await loadNativePlayoffSeedPreview('league-sp-1', 2026, deps)
    expect(preview?.locked).toBe(false)
    const fromBracket = bracketSeeds().seeds
    expect(preview!.seeds.map((s) => [s.redraftRosterId, s.seed])).toEqual(fromBracket)
    expect(fromBracket).toEqual([
      ['sp-east-1', 1],
      ['sp-west-1', 2],
      ['sp-east-2', 3],
      ['sp-east-3', 4],
    ])
    expect(preview!.seeds.find((s) => s.redraftRosterId === 'sp-west-1')?.qualifiedBy).toBe('division')
  })

  it('without divisions the same rosters seed by record (positive control: divisions are what moved it)', async () => {
    const preview = await loadNativePlayoffSeedPreview('league-sp-1', 2026, { ...deps, loadDivisions: async () => null })
    expect(preview!.seeds.map((s) => s.redraftRosterId)).toEqual(['sp-east-1', 'sp-east-2', 'sp-east-3', 'sp-east-4'])
  })

  it('re-keys each seed onto the generic roster id the standings rows carry (link or owner)', async () => {
    const preview = await loadNativePlayoffSeedPreview('league-sp-1', 2026, deps)
    expect(preview!.seeds.map((s) => s.rosterId)).toEqual([
      'generic-sp-east-1', // linked by owner only
      'generic-sp-west-1',
      'generic-sp-east-2',
      'generic-sp-east-3',
    ])
  })

  it('once the bracket exists, the preview shows the seeds it was built with, even if records move', async () => {
    const { generated } = bracketSeeds()
    const round = generated.bracket.rounds[0]!
    // Records change after generation: sp-east-4 would now out-rank everybody.
    const moved = ROSTERS.map((r) => (r.id === 'sp-east-4' ? { ...r, wins: 14, losses: 0 } : r))
    h.season = seasonRow({
      rosters: moved,
      playoffBracket: { id: 'bracket-sp-1', status: 'active', structure: {} },
      playoffRounds: [
        {
          id: 'round-sp-1',
          roundNumber: 1,
          roundName: round.roundName,
          status: 'active',
          matchups: round.matchups.map((m) => ({
            id: m.matchupId,
            matchupNumber: m.matchupNumber,
            homeRosterId: m.homeRosterId,
            awayRosterId: m.awayRosterId,
            homeSeed: m.homeSeed,
            awaySeed: m.awaySeed,
            homeScore: null,
            awayScore: null,
            winnerRosterId: null,
            nextMatchupId: m.nextMatchupId,
            status: 'scheduled',
            metadata: { bracketType: 'championship' },
          })),
        },
      ],
    })
    const preview = await loadNativePlayoffSeedPreview('league-sp-1', 2026, deps)
    expect(preview?.locked).toBe(true)
    expect(preview!.seeds.map((s) => [s.redraftRosterId, s.seed])).toEqual(bracketSeeds().seeds)
  })

  it('no native season: null, so the route falls back to its stored seeds', async () => {
    h.season = null
    expect(await loadNativePlayoffSeedPreview('league-sp-1', 2026, deps)).toBeNull()
  })

  it('currentNflRedraftPlayoffSeeds before generation is the state seeds', () => {
    const { state } = bracketSeeds()
    expect(currentNflRedraftPlayoffSeeds(state).seeds.map((s) => [s.rosterId, s.seed])).toEqual(state.seeds.map((s) => [s.rosterId, s.seed]))
  })
})

describe('computePlayoffSeeds on a native season', () => {
  it('stores the bracket seeding on FantasyStanding and clears seeds the runtime no longer gives', async () => {
    // computePlayoffSeeds uses the default deps: rules from the league-runtime mock, divisions from
    // league settings. Give the league no division_config, so seeding is by record.
    const { computePlayoffSeeds } = await import('@/server/services/playoffEngine')
    const seeds = await computePlayoffSeeds('league-sp-1', 2026)
    expect(seeds.map((s) => [s.rosterId, s.seed])).toEqual([
      ['generic-sp-east-1', 1],
      ['generic-sp-east-2', 2],
      ['generic-sp-east-3', 3],
      ['generic-sp-east-4', 4],
    ])
    expect(h.updates.map((u) => [u.where.leagueId_season_rosterId.rosterId, u.data.playoffSeed])).toEqual(seeds.map((s) => [s.rosterId, s.seed]))
    expect(h.cleared[0]?.where.rosterId.notIn).toEqual(seeds.map((s) => s.rosterId))
    expect(h.cleared[0]?.data).toEqual({ playoffSeed: null })
  })
})
