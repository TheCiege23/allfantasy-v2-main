/**
 * The real bracket generator against an in-memory DB: a regeneration must KEEP the commish's seed
 * order on the bracket row (it rewrites `structure` wholesale), write seeds and matchups from it, and
 * drop it only when the playoff team count is changed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  bracket: null as Row | null,
  seeds: [] as Row[],
  rounds: [] as Row[],
  matchups: [] as Row[],
  rosters: [] as Row[],
}))

vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => {
  const db: Row = {
    redraftSeason: {
      findFirst: vi.fn(async () => ({
        id: 'S1',
        leagueId: 'L1',
        sport: 'NFL',
        season: 2026,
        currentWeek: 15,
        status: 'playoffs',
        playoffStartWeek: 15,
        rosters: h.rosters.map((r) => ({ ...r })),
        playoffBracket: h.bracket ? { ...h.bracket } : null,
        playoffRounds: h.rounds.map((r) => ({ ...r, matchups: h.matchups.filter((m) => m.roundId === r.id) })),
      })),
      update: vi.fn(async () => ({})),
    },
    redraftPlayoffMatchup: {
      deleteMany: vi.fn(async () => { h.matchups = [] }),
      create: vi.fn(async ({ data }: { data: Row }) => { h.matchups.push({ ...data, homeScore: null, awayScore: null, nextMatchupId: null }) }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { Object.assign(h.matchups.find((m) => m.id === where.id)!, data) }),
    },
    redraftPlayoffRound: {
      deleteMany: vi.fn(async () => { h.rounds = [] }),
      create: vi.fn(async ({ data }: { data: Row }) => { h.rounds.push({ ...data }) }),
      findMany: vi.fn(async () => h.rounds),
    },
    redraftPlayoffSeed: {
      deleteMany: vi.fn(async () => { h.seeds = [] }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => { h.seeds.push(...data) }),
    },
    redraftPlayoffBracket: {
      upsert: vi.fn(async ({ update, create }: { update: Row; create: Row }) => {
        h.bracket = h.bracket ? { ...h.bracket, ...update } : { id: 'B1', ...create }
        return h.bracket
      }),
    },
    redraftRoster: {
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { Object.assign(h.rosters.find((r) => r.id === where.id)!, data) }),
    },
    league: { update: vi.fn(async () => ({})) },
    leagueEvent: { createMany: vi.fn(async () => ({})) },
  }
  db.$transaction = vi.fn(async (fn: (tx: Row) => Promise<unknown>) => fn(db))
  return { prisma: db }
})

import { generateNflRedraftPlayoffRuntimeBracket } from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'

beforeEach(() => {
  h.seeds = []
  h.rounds = []
  h.matchups = []
  // Standings A > B > C > D; the fallback rules take 4 of 4.
  h.rosters = ['A', 'B', 'C', 'D'].map((id, i) => ({
    id, ownerId: `u${id}`, ownerName: id, teamName: `Team ${id}`,
    wins: 10 - i, losses: 3 + i, ties: 0, pointsFor: 1400 - i, pointsAgainst: 1300, playoffSeed: null, isEliminated: false,
  }))
  h.bracket = { id: 'B1', status: 'active', structure: { playoffTeams: 4, manualSeeds: ['D', 'C', 'B', 'A'] } }
})

describe('regenerating a commish-seeded bracket', () => {
  it('keeps the order on the bracket row and builds seeds and matchups from it', async () => {
    await generateNflRedraftPlayoffRuntimeBracket({ seasonId: 'S1', regenerate: true, actorUserId: 'u' })
    expect(h.bracket!.structure.manualSeeds).toEqual(['D', 'C', 'B', 'A'])
    expect([...h.seeds].sort((a, b) => a.seed - b.seed).map((s) => s.rosterId)).toEqual(['D', 'C', 'B', 'A'])
    expect(h.rosters.find((r) => r.id === 'D')!.playoffSeed).toBe(1)
    const r1 = h.rounds.find((r) => r.roundNumber === 1)!
    const pairs = h.matchups.filter((m) => m.roundId === r1.id).sort((a, b) => a.matchupNumber - b.matchupNumber).map((m) => [m.homeRosterId, m.awayRosterId])
    expect(pairs).toEqual([['D', 'A'], ['C', 'B']])
  })

  it('drops the order when the playoff team count is changed', async () => {
    await generateNflRedraftPlayoffRuntimeBracket({ seasonId: 'S1', regenerate: true, playoffTeams: 2, actorUserId: 'u' })
    expect(h.bracket!.structure.manualSeeds).toBeUndefined()
    expect(h.seeds.map((s) => s.rosterId).sort()).toEqual(['A', 'B'])
  })

  it('a standings bracket never gains an order', async () => {
    h.bracket = { id: 'B1', status: 'active', structure: { playoffTeams: 4 } }
    await generateNflRedraftPlayoffRuntimeBracket({ seasonId: 'S1', regenerate: true, actorUserId: 'u' })
    expect(h.bracket!.structure.manualSeeds).toBeUndefined()
    expect([...h.seeds].sort((a, b) => a.seed - b.seed).map((s) => s.rosterId)).toEqual(['A', 'B', 'C', 'D'])
  })
})
