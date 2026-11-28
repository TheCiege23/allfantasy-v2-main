import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BOARD_SPORT_TABLE_KEY,
  boardPremiumsOf,
  learnedBoardNeedPremium,
  learnedBoardOn,
  learnedBoardPostureAdjustment,
  loadLearnedBoard,
  resetLearnedBoardMemo,
  type LearnedBoard,
} from '@/lib/trade-market/learnedInGrades'
import { BOARD_SPORT_MARKET_CACHE_KEY } from '@/lib/trade-market/boardSportLearning'
import { allocateNeedFactors, type NeedLine } from '@/lib/trade-value/viewerNeedFactors'
import { computeRosterNeed, readSlotRequirements } from '@/lib/trade-intel/rosterNeed'
import type { ScarcityBoard } from '@/lib/trade-intel/positionScarcity'
import { marketEvidenceOf } from '@/lib/chimmy/marketEvidence'

/**
 * NBA / MLB / NHL / NCAAB / soccer learned premiums in the "for your team" grade, behind TRADE_LEARNED_BOARD (off by
 * default; owner's call, 2026-11-22). Published premiums from a fresh table only, and never the NFL tables.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const doc = (generatedAt = '2026-11-22T06:00:00Z') => ({
  generatedAt,
  sports: [
    { sport: 'NBA', premiums: [
      { kind: 'posture', group: 'contend', premiumPct: 9, trades: 24, published: true },
      { kind: 'posture', group: 'rebuild', premiumPct: -6, trades: 8, published: false },
      { kind: 'need', group: 'C', premiumPct: 12, trades: 31, published: true },
      { kind: 'need', group: 'PG', premiumPct: -3, trades: 40, published: true },
      { kind: 'need', group: 'SF', premiumPct: null, trades: 2, published: false },
    ] },
    { sport: 'NHL', premiums: [{ kind: 'need', group: 'G', premiumPct: 18, trades: 22, published: true }] },
  ],
})

describe('reading the stored table', () => {
  it('the switch is off unless set to "on"', () => {
    expect(learnedBoardOn({} as NodeJS.ProcessEnv)).toBe(false)
    expect(learnedBoardOn({ TRADE_LEARNED_BOARD: 'ON ' } as never)).toBe(true)
  })

  it('one sport’s PUBLISHED premiums only; absent, stale or another sport = none', () => {
    expect(boardPremiumsOf(doc(), 'nba', NOW).map((p) => `${p.kind}:${p.group}`)).toEqual(['posture:contend', 'need:C', 'need:PG'])
    expect(boardPremiumsOf(doc(), 'MLB', NOW)).toEqual([])
    expect(boardPremiumsOf(doc('2026-10-25T00:00:00Z'), 'NBA', NOW)).toEqual([])
    expect(boardPremiumsOf(null, 'NBA', NOW)).toEqual([])
  })

  it('reads the key the daily job writes, once per ten minutes', async () => {
    expect(BOARD_SPORT_TABLE_KEY).toBe(BOARD_SPORT_MARKET_CACHE_KEY)
    resetLearnedBoardMemo()
    const findUnique = vi.fn(async (_: { where: { cacheKey: string } }) => ({ data: doc() }))
    const prisma = { sportsDataCache: { findUnique } }
    expect((await loadLearnedBoard(prisma, 'nba', NOW)).premiums).toHaveLength(3)
    expect((await loadLearnedBoard(prisma, 'NHL', NOW)).premiums).toHaveLength(1)
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(findUnique.mock.calls[0]![0].where.cacheKey).toBe(BOARD_SPORT_MARKET_CACHE_KEY)
    resetLearnedBoardMemo()
  })
})

describe('the two moves', () => {
  const board: LearnedBoard = { sport: 'NBA', premiums: boardPremiumsOf(doc(), 'NBA', NOW) }

  it('need: a published, positive premium for the position; a discount or an unmeasured position is not used', () => {
    expect(learnedBoardNeedPremium(board, 'c')).toEqual({ pct: 12, trades: 31 })
    expect(learnedBoardNeedPremium(board, 'PG')).toBeNull()
    expect(learnedBoardNeedPremium(board, 'SF')).toBeNull()
  })

  it('posture: your record’s number, said with the sport; middle teams and unpublished records move nothing', () => {
    const move = learnedBoardPostureAdjustment(board, 'contend')!
    expect(move.factor).toBeCloseTo(1.09)
    expect(move.reason).toBe('teams at .600 or better paid +9% over middle-of-the-table teams across 24 completed NBA trades')
    expect(learnedBoardPostureAdjustment(board, 'rebuild')).toBeNull()
    expect(learnedBoardPostureAdjustment(board, 'middle')).toBeNull()
    expect(learnedBoardPostureAdjustment(board, null)).toBeNull()
  })
})

describe('in the "for your team" grade', () => {
  const requirements = readSlotRequirements(['PG', 'SG', 'SF', 'PF', 'C', 'BN'])!
  const needOf = (positions: string[]) => computeRosterNeed({ requirements, rostered: positions })
  const wire: ScarcityBoard = new Map([['C', { position: 'C', freeAgents: 0, scarcity: 1 }]])
  const noC = needOf(['PG', 'SG', 'SF', 'PF'])
  const full = needOf(['PG', 'SG', 'SF', 'PF', 'C'])
  const line = (name: string, position: string | null, over: Partial<NeedLine> = {}): NeedLine => ({ name, position, base: 40, ...over })
  const empty = { picks: new Map(), need: new Map(), posture: new Map() }
  const board: LearnedBoard = { sport: 'NBA', premiums: boardPremiumsOf(doc(), 'NBA', NOW) }
  const run = (get: NeedLine[], learned: Parameters<typeof allocateNeedFactors>[0]['learned'], before = noC) =>
    allocateNeedFactors({ give: [], get, needAfterOutgoing: before, needAfterTrade: full, scarcity: wire, learned })

  beforeEach(() => resetLearnedBoardMemo())

  it('an open C slot takes the premium NBA teams with no spare at C paid, and says so', () => {
    const hand = run([line('A Center', 'C')], null).get[0]!
    const out = run([line('A Center', 'C')], { book: 'SPORT:NBA', tables: empty, need: true, posture: null, board }).get[0]!
    expect(out.factor).toBeCloseTo(1.12, 6)
    expect(out.factor).not.toBeCloseTo(hand.factor, 3)
    expect(out.reason).toMatch(/teams with no spare at C paid \+12% over teams with depth there across 31 completed NBA trades$/)
  })

  it('your record moves every PLAYER you take on — never a pick, never a middle team', () => {
    const learned = { book: 'SPORT:NBA', tables: empty, need: true, posture: 'contend' as const, board }
    const out = run([line('A Guard', 'PG'), line('2027 1st', null, { isPick: true })], learned, full).get
    expect(out[0]!.factor).toBeCloseTo(1.09, 6)
    expect(out[1]).toBeNull()
    expect(run([line('A Guard', 'PG')], { ...learned, posture: 'middle' }, full).get[0]).toBeNull()
  })

  it('need and posture on the same player multiply, and both reasons reach the evidence list', () => {
    const out = run([line('A Center', 'C')], { book: 'SPORT:NBA', tables: empty, need: true, posture: 'contend', board }).get[0]!
    expect(out.factor).toBeCloseTo(1.12 * 1.09, 6)
    const evidence = marketEvidenceOf({ graded: true, moves: [], rosterFit: { moves: [{ side: 'get', name: 'A Center', reasons: out.reason.split('; ') }] } } as never)
    expect(evidence.join(' | ')).toMatch(/31 completed NBA trades/)
    expect(evidence.join(' | ')).toMatch(/24 completed NBA trades/)
  })
})
