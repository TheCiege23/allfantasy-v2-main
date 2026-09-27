// @vitest-environment node
/**
 * THE grade on a League Buzz trade (2026-09-27) — `lib/activity/tradeGrades.ts`.
 *
 * The feed behind /core's Comms drawer and the league feed page listed a trade as "A gets X · B gets
 * Y" and nothing else. Pinned here: which side a Sleeper pick lands on (`owner_id`, never the
 * original `roster_id`), what withholds a letter, the per-transaction memo that keeps a 90-second
 * poll from regrading, and native trades read from their frozen receipts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { graderFor, gradeArchived, snapshotFindMany, store } = vi.hoisted(() => ({
  graderFor: vi.fn(),
  gradeArchived: vi.fn(),
  snapshotFindMany: vi.fn(),
  store: { receipts: true },
}))

vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({
  completedTradeGraderFor: graderFor,
  gradeArchivedTrade: gradeArchived,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    get tradeDecisionSnapshot() {
      return store.receipts ? { findMany: snapshotFindMany } : undefined
    },
  },
}))

import {
  clearActivityTradeGradeMemo,
  gradeSleeperActivityTrade,
  nativeTradeReceiptGrades,
} from '@/lib/activity/tradeGrades'

const GRADED = { graded: true, letter: 'B', partnerLetter: 'D' }
const NAMES = new Map([[1, 'Hoovi'], [2, 'Nicolodeon']])
const PLAYERS = { p1: { full_name: 'Woody Marks' }, p2: { first_name: 'Rachaad', last_name: 'White' } }

const tx = (over: Record<string, unknown> = {}) => ({
  type: 'trade', transaction_id: 'tx-1', status: 'complete', roster_ids: [1, 2],
  adds: { p1: 1, p2: 2 }, drops: { p1: 2, p2: 1 },
  // Roster 2's ORIGINAL pick, now owned by roster 1 — so roster 1 RECEIVED it.
  draft_picks: [{ season: '2027', round: 2, roster_id: 2, previous_owner_id: 2, owner_id: 1 }],
  waiver_budget: [], leg: 1, created: 0, creator: 'x', consenter_ids: [1, 2], status_updated: 0,
  ...over,
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  clearActivityTradeGradeMemo()
  store.receipts = true
  graderFor.mockResolvedValue({ grader: true })
  gradeArchived.mockResolvedValue(GRADED)
})

describe('gradeSleeperActivityTrade', () => {
  it('grades from roster one’s side: its players, and the picks it OWNS now (owner_id), never roster_id', async () => {
    const g = await gradeSleeperActivityTrade({ afLeagueId: 'af-1', tx: tx(), rosterNames: NAMES, players: PLAYERS, now: 0 })
    expect(graderFor).toHaveBeenCalledWith('af-1')
    expect(gradeArchived).toHaveBeenCalledWith({ grader: true }, {
      received: ['Woody Marks'],
      gave: ['Rachaad White'],
      picksIn: [{ season: 2027, round: 2, label: '2027 round 2' }],
      picksOut: [],
      currentSeason: 1970,
    })
    expect(g).toEqual({ graded: true, basis: 'today', sides: [{ name: 'Hoovi', letter: 'B' }, { name: 'Nicolodeon', letter: 'D' }] })
  })

  it('an unnamed player reaches the grader as null, so it withholds rather than prices a raw id', async () => {
    await gradeSleeperActivityTrade({ afLeagueId: 'af-1', tx: tx({ adds: { p1: 1, zzz: 2 } }), rosterNames: NAMES, players: PLAYERS, now: 0 })
    expect(gradeArchived.mock.calls[0]![1].gave).toEqual([null])
  })

  it('withholds FAAB trades and three-team trades without asking the grader', async () => {
    const faab = await gradeSleeperActivityTrade({ afLeagueId: 'af-1', tx: tx({ waiver_budget: [{ sender: 2, receiver: 1, amount: 15 }] }), rosterNames: NAMES, players: PLAYERS, now: 0 })
    expect(faab).toEqual({ graded: false, reason: 'FAAB in this trade is not priced on the league chart' })
    const three = await gradeSleeperActivityTrade({ afLeagueId: 'af-1', tx: tx({ transaction_id: 'tx-3', roster_ids: [1, 2, 3] }), rosterNames: NAMES, players: PLAYERS, now: 0 })
    expect(three).toEqual({ graded: false, reason: 'only two-team trades are graded' })
    expect(gradeArchived).not.toHaveBeenCalled()
  })

  it('passes the grader’s own withheld reason through', async () => {
    gradeArchived.mockResolvedValue({ graded: false, reason: '1 asset has no value on this league’s chart', basis: null })
    const g = await gradeSleeperActivityTrade({ afLeagueId: 'af-1', tx: tx(), rosterNames: NAMES, players: PLAYERS, now: 0 })
    expect(g).toEqual({ graded: false, reason: '1 asset has no value on this league’s chart' })
  })

  it('🛑 a poll inside the memo window does NOT regrade; one after it does', async () => {
    const args = { afLeagueId: 'af-1', tx: tx(), rosterNames: NAMES, players: PLAYERS }
    await gradeSleeperActivityTrade({ ...args, now: 0 })
    await gradeSleeperActivityTrade({ ...args, now: 90_000 })
    expect(gradeArchived).toHaveBeenCalledTimes(1)
    await gradeSleeperActivityTrade({ ...args, now: 11 * 60_000 })
    expect(gradeArchived).toHaveBeenCalledTimes(2)
  })

  it('a grading failure is no grade, never a throw', async () => {
    gradeArchived.mockRejectedValue(new Error('chart down'))
    expect(await gradeSleeperActivityTrade({ afLeagueId: 'af-1', tx: tx(), rosterNames: NAMES, players: PLAYERS, now: 0 })).toBeNull()
  })
})

describe('nativeTradeReceiptGrades', () => {
  const row = (tradeId: string, a: string | null, b: string | null) => ({
    tradeId, completeness: 'complete', policyVersion: 'p', format: 'redraft', capturedAt: new Date(0),
    evidence: {}, readiness: {}, outcomeSimulation: {}, assetContext: {},
    decisionResult: { participants: [
      { rosterId: 'r1', grade: a, reason: 'x' },
      { rosterId: 'r2', grade: b, reason: 'x' },
    ] },
  })
  const names = (id: string) => ({ r1: 'Ada', r2: 'Bea' } as Record<string, string>)[id] ?? 'A manager'

  it('reads each trade’s letters AT PROPOSAL from its receipt, in one query', async () => {
    snapshotFindMany.mockResolvedValue([row('t1', 'A', 'F'), row('t2', null, null)])
    const out = await nativeTradeReceiptGrades(['t1', 't2'], names)
    expect(snapshotFindMany).toHaveBeenCalledTimes(1)
    expect(out.get('t1')).toEqual({ graded: true, basis: 'at-proposal', sides: [{ name: 'Ada', letter: 'A' }, { name: 'Bea', letter: 'F' }] })
    // A receipt with a withheld letter draws nothing — never a stand-in.
    expect(out.has('t2')).toBe(false)
  })

  it('no receipt table, or an unreadable one: no grades, never a throw', async () => {
    store.receipts = false
    expect((await nativeTradeReceiptGrades(['t1'], names)).size).toBe(0)
    store.receipts = true
    snapshotFindMany.mockRejectedValue(new Error('relation does not exist'))
    expect((await nativeTradeReceiptGrades(['t1'], names)).size).toBe(0)
  })
})
