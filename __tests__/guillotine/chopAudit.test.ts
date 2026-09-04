/**
 * The audit half of a chop — the capability that only the manual engine had.
 *
 * 🛑 WHAT THE MERGE ACTUALLY WAS. There were two guillotine elimination engines and neither was a
 * superset. The automation engine (what specialty automation calls) had the week evaluator, the
 * stat-correction cutoff, the tiebreak resolver with commissioner override, roster release, chat and
 * the event log. The manual engine (a POST route only) had the idempotency guard, a transaction, the
 * `GuillotineElimination` record, the survival log, the season counters and the endgame transition.
 * Deleting either destroyed seven real behaviours, which is why both had survived.
 *
 * This module is the manual engine's half, lifted so the automation engine can call it — and these
 * tests pin the parts that were easy to get wrong in the lifting.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  seasonFindFirst: vi.fn(),
  elimFindFirst: vi.fn(),
  elimCreate: vi.fn(),
  survivalUpsert: vi.fn(),
  seasonUpdate: vi.fn(),
  transaction: vi.fn(),
  seasonFindUnique: vi.fn(),
  leagueFindUnique: vi.fn(),
  transition: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotineSeason: { findFirst: h.seasonFindFirst, update: h.seasonUpdate, findUnique: h.seasonFindUnique },
    league: { findUnique: h.leagueFindUnique },
    guillotineElimination: { findFirst: h.elimFindFirst, create: h.elimCreate },
    guillotineSurvivalLog: { upsert: h.survivalUpsert },
    $transaction: h.transaction,
  },
}))

vi.mock('@/lib/guillotine/endgameEngine', () => ({ transitionToFinalStage: h.transition }))

import {
  findGuillotineSeasonId,
  isPeriodAlreadyRecorded,
  recordChopAudit,
} from '@/lib/guillotine/guillotineChopAudit'

const tx = {
  guillotineElimination: { create: h.elimCreate },
  guillotineSurvivalLog: { upsert: h.survivalUpsert },
  guillotineSeason: { update: h.seasonUpdate },
}

const input = (over: Record<string, unknown> = {}) => ({
  leagueId: 'L1',
  season: 2026,
  scoringPeriod: 4,
  chopped: [
    {
      redraftRosterId: 'rr-chopped',
      teamName: 'Doomed',
      ownerId: 'owner-1',
      score: 61.2,
      rankAmongActive: 18,
      marginBelowSafe: -8.4,
    },
  ],
  standings: [
    { redraftRosterId: 'rr-top', score: 140.1, rankAmongActive: 1, eliminated: false, marginAboveChopLine: 78.9, wasInDangerZone: false },
    { redraftRosterId: 'rr-chopped', score: 61.2, rankAmongActive: 18, eliminated: true, marginAboveChopLine: -8.4, wasInDangerZone: false },
  ],
  teamsActiveThisPeriod: 18,
  wasTiebreaker: false,
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  h.transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx))
  h.elimCreate.mockResolvedValue({})
  h.survivalUpsert.mockResolvedValue({})
  h.seasonUpdate.mockResolvedValue({})
  h.transition.mockResolvedValue(undefined)
  // Default: field still large, so no transition.
  h.seasonFindUnique.mockResolvedValue({ currentTeamsActive: 10, isInFinalStage: false })
  h.leagueFindUnique.mockResolvedValue({ guillotineEndgameThreshold: 2 })
})

describe('🛑 optional when there is no season row — the common case', () => {
  it('reports no_guillotine_season and writes nothing', async () => {
    /*
     * Production holds ZERO GuillotineSeason rows: only a manual POST creates one, and nobody has
     * for the 12 live guillotine leagues. So this is what almost every chop reports today. The chop
     * itself still happened; only the bookkeeping did not.
     */
    h.seasonFindFirst.mockResolvedValue(null)

    const out = await recordChopAudit(input())

    expect(out).toEqual({ recorded: false, reason: 'no_guillotine_season' })
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.elimCreate).not.toHaveBeenCalled()
  })

  it('🛑 does NOT create a season row as a side effect of a chop', async () => {
    // Guap's decision. A chop that silently materialises season state is hard to reason about
    // later; "the audit did not run because there is no season" is a fact worth surfacing.
    h.seasonFindFirst.mockResolvedValue(null)
    await recordChopAudit(input())
    expect(h.seasonUpdate).not.toHaveBeenCalled()
  })
})

describe('🛑 idempotency — the guard the automation engine never had', () => {
  it('refuses a period that was already audited', async () => {
    /*
     * `GuillotineElimination` carries indexes but NO unique constraint, so the database will not
     * catch a duplicate. Re-triggering a week would otherwise write a second elimination row for it
     * — invisibly, because `guillotineRosterState` is an upsert and would look unchanged.
     */
    h.seasonFindFirst.mockResolvedValue({ id: 'gs1' })
    h.elimFindFirst.mockResolvedValue({ id: 'already-here' })

    const out = await recordChopAudit(input())

    expect(out).toEqual({ recorded: false, reason: 'already_recorded' })
    expect(h.transaction).not.toHaveBeenCalled()
  })
})

describe('the audit itself', () => {
  beforeEach(() => {
    h.seasonFindFirst.mockResolvedValue({ id: 'gs1' })
    h.elimFindFirst.mockResolvedValue(null)
  })

  it('writes an elimination row and a survival row per team', async () => {
    const out = await recordChopAudit(input())

    // `finalStageReached` is part of the result now that the endgame transition moved here from
    // the deleted engine. Asserted exactly rather than loosened to toMatchObject: a result gaining
    // a field silently is how a caller ends up reading one that was never set.
    expect(out).toEqual({
      recorded: true, seasonId: 'gs1', eliminations: 1, survivalRows: 2, finalStageReached: false,
    })
    expect(h.elimCreate).toHaveBeenCalledTimes(1)
    expect(h.survivalUpsert).toHaveBeenCalledTimes(2)
    expect(h.elimCreate.mock.calls[0][0].data).toMatchObject({
      seasonId: 'gs1',
      eliminatedRosterId: 'rr-chopped',
      scoringPeriod: 4,
      finalScore: 61.2,
    })
  })

  it('🛑 records whether a tie was actually broken, where the old engine hardcoded false', async () => {
    /*
     * `eliminationEngine` always wrote `wasTiebreaker: false` because its tiebreak was inline and it
     * never reported which step decided. The automation engine runs `resolveTiebreak`, which does —
     * so the audit can finally record the thing a manager actually disputes.
     */
    await recordChopAudit(input({ wasTiebreaker: true }))
    expect(h.elimCreate.mock.calls[0][0].data.wasTiebreaker).toBe(true)
  })

  it('marks survivors and the eliminated distinctly in the survival log', async () => {
    await recordChopAudit(input())
    const statuses = h.survivalUpsert.mock.calls.map((c) => c[0].create.survivalStatus)
    expect(statuses).toEqual(['survived', 'eliminated'])
  })

  it('🛑 DECREMENTS the active count rather than assigning the scored count', async () => {
    /*
     * The caller knows how many teams it SCORED, which is not how many are active — a team with no
     * score row is absent from the standings but still alive. Assigning would let one incomplete
     * scoring week silently redefine the size of the field.
     */
    await recordChopAudit(input())
    expect(h.seasonUpdate.mock.calls[0][0].data).toMatchObject({
      currentScoringPeriod: 4,
      currentTeamsActive: { decrement: 1 },
    })
  })

  it('advances the period but leaves the count alone when nobody was chopped', async () => {
    await recordChopAudit(input({ chopped: [] }))
    const data = h.seasonUpdate.mock.calls[0][0].data
    expect(data.currentScoringPeriod).toBe(4)
    expect('currentTeamsActive' in data).toBe(false)
  })

  it('writes everything inside one transaction', async () => {
    await recordChopAudit(input())
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })
})

describe('season lookup', () => {
  it('scopes to the season when one is given', async () => {
    h.seasonFindFirst.mockResolvedValue({ id: 'gs1' })
    await findGuillotineSeasonId('L1', 2026)
    expect(h.seasonFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'L1', season: 2026 } }),
    )
  })

  it('falls back to the newest season when none is given', async () => {
    h.seasonFindFirst.mockResolvedValue({ id: 'gs1' })
    await findGuillotineSeasonId('L1', null)
    const arg = h.seasonFindFirst.mock.calls[0][0]
    expect(arg.where).toEqual({ leagueId: 'L1' })
    expect(arg.orderBy).toEqual({ season: 'desc' })
  })

  it('reports a period as unrecorded when nothing is there', async () => {
    h.elimFindFirst.mockResolvedValue(null)
    expect(await isPeriodAlreadyRecorded('gs1', 4)).toBe(false)
  })
})

describe('🛑 the final-stage transition, ported from the engine that was deleted', () => {
  beforeEach(() => {
    h.seasonFindFirst.mockResolvedValue({ id: 'gs1' })
    h.elimFindFirst.mockResolvedValue(null)
  })

  it('does not transition while the field is above the threshold', async () => {
    h.seasonFindUnique.mockResolvedValue({ currentTeamsActive: 10, isInFinalStage: false })
    const out = await recordChopAudit(input())
    expect(h.transition).not.toHaveBeenCalled()
    expect(out).toMatchObject({ recorded: true, finalStageReached: false })
  })

  it('🛑 transitions once the field reaches the threshold', async () => {
    /*
     * This is the capability the deletion would otherwise have taken with it. `eliminationEngine`
     * was the ONLY caller of `transitionToFinalStage`; removing it without porting this would have
     * left that function with zero callers, and no guillotine league would ever have entered its
     * final stage again. Nothing would have failed — the season would simply never end.
     */
    h.seasonFindUnique.mockResolvedValue({ currentTeamsActive: 2, isInFinalStage: false })
    const out = await recordChopAudit(input())
    expect(h.transition).toHaveBeenCalledWith('gs1', 4)
    expect(out).toMatchObject({ finalStageReached: true })
  })

  it('does not transition twice', async () => {
    h.seasonFindUnique.mockResolvedValue({ currentTeamsActive: 1, isInFinalStage: true })
    const out = await recordChopAudit(input())
    expect(h.transition).not.toHaveBeenCalled()
    expect(out).toMatchObject({ finalStageReached: false })
  })

  it('falls back to a threshold of 1 when the league sets none', async () => {
    h.leagueFindUnique.mockResolvedValue({ guillotineEndgameThreshold: null })
    h.seasonFindUnique.mockResolvedValue({ currentTeamsActive: 1, isInFinalStage: false })
    await recordChopAudit(input())
    expect(h.transition).toHaveBeenCalled()
  })
})
