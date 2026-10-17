/**
 * Playoff weeks in the commish past-week lineup editor: the decision of what a re-scored round may
 * change (lib/league/commishPlayoffLineup.ts `planPlayoffRescore`). The rule that matters: a re-score
 * may move a different team into the next round ONLY while that round is unplayed, never once the
 * champion is decided, and never in a league that reseeds after every round.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  points: {} as Record<string, number>,
  runtimeState: null as unknown,
  updates: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const tx = {
    redraftPlayoffMatchup: {
      findUnique: vi.fn(async () => ({ metadata: { scoredWeeks: [15] } })),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        h.updates.push(args)
        return {}
      }),
    },
  }
  return { prisma: { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } }
})
vi.mock('@/lib/redraft/scoringEngine', () => ({
  scoreRosterForWeek: vi.fn(async ({ rosterId, week }: { rosterId: string; week: number }) => ({ points: h.points[`${rosterId}:${week}`] ?? 0 })),
}))
vi.mock('@/lib/playoff-runtime', () => ({
  resolveNflRedraftPlayoffRuntime: vi.fn(async () => ({ ok: true, state: h.runtimeState, season: { status: 'playoffs' } })),
}))

import { planPlayoffRescore, rescorePlayoffMatchup, winnerOnScores } from '@/lib/league/commishPlayoffLineup'

beforeEach(() => {
  h.points = {}
  h.updates = []
})

type M = Record<string, unknown>
const matchup = (o: M) => ({
  roundId: 'r', roundName: 'R', matchupNumber: 1, bracketType: 'championship', loserRosterId: null,
  bye: false, complete: false, status: 'final', metadata: {}, homeSeed: null, awaySeed: null,
  homeScore: null, awayScore: null, winnerRosterId: null, nextMatchupId: null, ...o,
})

/** Round 1: A (seed 1) beat D (seed 4) and B (2) beat C (3); round 2 is A v B, unplayed. */
function state(o: { r1?: M; next?: M; reseed?: boolean; bracketStatus?: string } = {}) {
  const r1 = matchup({ matchupId: 'm1', roundNumber: 1, homeRosterId: 'A', awayRosterId: 'D', homeSeed: 1, awaySeed: 4, homeScore: 110, awayScore: 100, winnerRosterId: 'A', nextMatchupId: 'f', complete: true, ...o.r1 })
  const r1b = matchup({ matchupId: 'm2', roundNumber: 1, homeRosterId: 'B', awayRosterId: 'C', homeSeed: 2, awaySeed: 3, homeScore: 95, awayScore: 90, winnerRosterId: 'B', nextMatchupId: 'f', complete: true })
  const fin = matchup({ matchupId: 'f', roundNumber: 2, homeRosterId: 'A', awayRosterId: 'B', homeSeed: 1, awaySeed: 2, status: 'scheduled', ...o.next })
  return {
    settings: { reseedAfterEachRound: Boolean(o.reseed) },
    bracket: {
      status: o.bracketStatus ?? 'active',
      rounds: [
        { roundNumber: 1, status: 'completed', matchups: [r1, r1b] },
        { roundNumber: 2, status: 'active', matchups: [fin] },
      ],
    },
  } as never
}
const plan = (s: never, homeScore: number, awayScore: number, seasonComplete = false) =>
  planPlayoffRescore({ state: s, seasonComplete, matchupId: 'm1', homeScore, awayScore })

describe('winnerOnScores', () => {
  it('points first, then the better (lower) seed; equal seeds is nobody', () => {
    const base = { homeRosterId: 'A', awayRosterId: 'D', homeSeed: 1, awaySeed: 4 }
    expect(winnerOnScores({ ...base, homeScore: 90, awayScore: 100 })).toBe('D')
    expect(winnerOnScores({ ...base, homeScore: 100, awayScore: 100 })).toBe('A')
    expect(winnerOnScores({ ...base, homeSeed: 3, awaySeed: 3, homeScore: 100, awayScore: 100 })).toBeNull()
  })
})

describe('planPlayoffRescore', () => {
  it('same winner: write the new scores, touch nothing else', () => {
    expect(plan(state(), 120, 101)).toEqual({ ok: true, winnerRosterId: 'A', flipped: false, next: null })
  })

  it('not decided yet (scored, waiting on the roller): write the scores and let the roller decide', () => {
    expect(plan(state({ r1: { winnerRosterId: null } }), 90, 101)).toEqual({ ok: true, winnerRosterId: null, flipped: false, next: null })
  })

  it('a flip while the next round is unplayed puts the new winner in the old winner’s seat, with his seed', () => {
    expect(plan(state(), 90, 101)).toEqual({
      ok: true,
      winnerRosterId: 'D',
      flipped: true,
      next: { matchupId: 'f', slot: 'home', rosterId: 'D', seed: 4 },
    })
  })

  it.each([
    ['the next round has a score', { next: { homeScore: 80, awayScore: 70 } }],
    ['the next round has a winner', { next: { winnerRosterId: 'B' } }],
    ['the league reseeds after every round', { reseed: true }],
    ['the commish picked this winner by hand', { r1: { metadata: { commissionerOverride: true } } }],
    ['the re-score ties two equal seeds', { r1: { homeSeed: 2, awaySeed: 2 } }],
  ])('refuses a flip when %s', (_label, o) => {
    const tie = Boolean((o as { r1?: M }).r1?.homeSeed)
    const r = plan(state(o as never), tie ? 100 : 90, tie ? 100 : 101)
    expect(r.ok).toBe(false)
  })

  it('refuses a flip that would change the champion', () => {
    const s = state() as unknown as { bracket: { rounds: Array<{ matchups: M[] }> } }
    // Re-score the final itself: A beat B; now B would.
    s.bracket.rounds[1]!.matchups[0] = { ...s.bracket.rounds[1]!.matchups[0], status: 'final', homeScore: 120, awayScore: 110, winnerRosterId: 'A' }
    const r = planPlayoffRescore({ state: s as never, seasonComplete: true, matchupId: 'f', homeScore: 100, awayScore: 110 })
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('champion') })
    // ...and a score change that keeps the champion is fine.
    expect(planPlayoffRescore({ state: s as never, seasonComplete: true, matchupId: 'f', homeScore: 130, awayScore: 110 }).ok).toBe(true)
  })
})

describe('rescorePlayoffMatchup', () => {
  const M1 = { matchupId: 'm1', roundNumber: 1, weeks: [15, 16], homeRosterId: 'A', awayRosterId: 'D', homeScore: 110, awayScore: 100, winnerPicked: false }
  const run = () => rescorePlayoffMatchup({ leagueId: 'L1', seasonId: 'S1', seasonYear: 2026, matchup: M1 })

  it('sums every week of the round, and a flip writes the scores, the winner and the next-round seat', async () => {
    h.runtimeState = state()
    h.points = { 'A:15': 50, 'A:16': 40, 'D:15': 45, 'D:16': 56 }
    expect(await run()).toEqual({ ok: true, homeScore: 90, awayScore: 101, flipped: true, winnerRosterId: 'D' })
    expect(h.updates).toHaveLength(2)
    expect(h.updates[0]).toMatchObject({ where: { id: 'm1' }, data: { homeScore: 90, awayScore: 101, winnerRosterId: 'D' } })
    expect(h.updates[0]!.data.metadata).toMatchObject({ scoredWeeks: [15], commishLineupRescoredAt: expect.any(String) })
    expect(h.updates[1]).toEqual({ where: { id: 'f' }, data: { homeRosterId: 'D', homeSeed: 4 } })
  })

  it('a refused flip writes nothing at all', async () => {
    h.runtimeState = state({ next: { homeScore: 80, awayScore: 70 } })
    h.points = { 'A:15': 50, 'A:16': 40, 'D:15': 45, 'D:16': 56 }
    expect((await run()).ok).toBe(false)
    expect(h.updates).toEqual([])
  })
})
