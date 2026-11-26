/**
 * The AI Commissioner's trade-fairness watchlist reads THE grade.
 *
 * It used to compute its own "fairness score" from `LeagueTrade.valueGiven/valueReceived`
 * (|gap| / max → 100 − gap, ≤45 "Immediate commissioner review"), where two NULL columns scored a
 * perfect 100/100 for a trade nobody had priced. Every number below must come from the graded rows
 * `loadGradedLeagueTradeRows` returns (the one grader, as /core Trades reads it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadGradedLeagueTradeRows, leagueFindUnique, leagueTradeFindFirst } = vi.hoisted(() => ({
  loadGradedLeagueTradeRows: vi.fn(),
  leagueFindUnique: vi.fn(),
  leagueTradeFindFirst: vi.fn(),
}))
vi.mock('@/lib/core-app/leagueTradeRowGrades', () => ({ loadGradedLeagueTradeRows }))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: leagueFindUnique }, leagueTrade: { findFirst: leagueTradeFindFirst } },
}))

import {
  loadTradeFairnessWatchlist,
  controversyFromLetter,
  explainTradeFairnessInsight,
  getTradeFairnessByTradeId,
} from '@/lib/ai-commissioner/TradeFairnessAnalyzer'

const row = (transactionId: string, extra: Record<string, unknown> = {}) => ({
  transactionId,
  season: 2026,
  week: 3,
  playersGiven: ['4984'],
  playersReceived: ['6794'],
  picksGiven: [],
  picksReceived: [],
  partnerName: 'Rival',
  partnerRosterId: 7,
  tradeDate: new Date('2026-10-01T12:00:00Z'),
  history: { sleeperUsername: 'me' },
  // The OLD inputs: present and wildly lopsided. The analyzer must not read them.
  valueGiven: 9000,
  valueReceived: 10,
  ...extra,
})
const graded = (letter: string, partnerLetter: string, percentDiff: number) => ({
  grade: { graded: true, letter, partnerLetter, percentDiff, giveValue: 100, getValue: 100 + percentDiff, basis: 'Dynasty · SF' },
})
const withheld = (reason: string) => ({ grade: { graded: false, reason, basis: null } })

function loaded(entries: Array<[ReturnType<typeof row>, unknown]>) {
  return {
    available: true,
    rows: entries.map(([r]) => r),
    graded: new Map(entries.map(([r, g]) => [r.transactionId, g])),
    nameOf: () => null,
    positionOf: () => null,
    providerIds: false,
  }
}

beforeEach(() => {
  loadGradedLeagueTradeRows.mockReset()
  leagueTradeFindFirst.mockReset()
  leagueFindUnique.mockReset().mockResolvedValue({ id: 'L1', sport: 'NFL', platformLeagueId: 'sl-1', platform: 'sleeper' })
})

describe('controversyFromLetter — the letter’s own band, no threshold of its own', () => {
  it.each([
    ['A', 'high'],
    ['F', 'high'],
    ['B', 'medium'],
    ['D', 'medium'],
    ['C', 'low'],
    [null, 'unknown'],
  ])('%s → %s', (letter, level) => expect(controversyFromLetter(letter as string | null)).toBe(level))
})

describe('loadTradeFairnessWatchlist', () => {
  it('reads the graded rows of the one grader for this league', async () => {
    loadGradedLeagueTradeRows.mockResolvedValue(loaded([[row('t1'), graded('C', 'C', 2)]]))
    await loadTradeFairnessWatchlist({ leagueId: 'L1' })
    expect(loadGradedLeagueTradeRows).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'L1', platformLeagueId: 'sl-1', sport: 'NFL', platform: 'sleeper' }),
    )
  })

  it('every number is the canonical grade’s — the stale valueGiven/valueReceived columns are ignored', async () => {
    loadGradedLeagueTradeRows.mockResolvedValue(loaded([[row('t1'), graded('C', 'C', -3)]]))
    const [i] = await loadTradeFairnessWatchlist({ leagueId: 'L1' })
    // The old rule on valueGiven 9000 / valueReceived 10 would say ~0/100, "high".
    expect(i).toMatchObject({
      tradeId: 't1',
      graded: true,
      letter: 'C',
      partnerLetter: 'C',
      imbalancePct: 3,
      fairnessScore: 97,
      controversyLevel: 'low',
      withheldReason: null,
      relatedManagerIds: ['7'],
    })
    expect(i.summary).toContain('grades C / C')
  })

  it('a lopsided canonical grade is high controversy and ranks first', async () => {
    loadGradedLeagueTradeRows.mockResolvedValue(
      loaded([
        [row('even'), graded('C', 'C', 1)],
        [row('lean'), graded('B', 'D', 12)],
        [row('steal'), graded('F', 'A', -48)],
      ]),
    )
    const out = await loadTradeFairnessWatchlist({ leagueId: 'L1' })
    expect(out.map((i) => [i.tradeId, i.controversyLevel])).toEqual([
      ['steal', 'high'],
      ['lean', 'medium'],
      ['even', 'low'],
    ])
  })

  it('a WITHHELD grade is never scored: no numbers, unknown, the grader’s reason, ranked after graded trades', async () => {
    loadGradedLeagueTradeRows.mockResolvedValue(
      loaded([
        [row('w', { valueGiven: null, valueReceived: null }), withheld('a player with no name on file')],
        [row('g'), graded('C', 'C', 0)],
      ]),
    )
    const out = await loadTradeFairnessWatchlist({ leagueId: 'L1' })
    expect(out.map((i) => i.tradeId)).toEqual(['g', 'w'])
    expect(out[1]).toMatchObject({
      graded: false,
      letter: null,
      fairnessScore: null,
      imbalancePct: null,
      controversyLevel: 'unknown',
      withheldReason: 'a player with no name on file',
    })
    expect(explainTradeFairnessInsight(out[1])).not.toMatch(/\d+\/100/)
  })

  it('no synced trades → an empty watchlist, never a fabricated one', async () => {
    loadGradedLeagueTradeRows.mockResolvedValue({ available: false, reason: 'no trades on file for this league' })
    expect(await loadTradeFairnessWatchlist({ leagueId: 'L1' })).toEqual([])
  })

  it('filters to the requested season', async () => {
    loadGradedLeagueTradeRows.mockResolvedValue(
      loaded([
        [row('old', { season: 2025 }), graded('A', 'F', 50)],
        [row('now'), graded('C', 'C', 0)],
      ]),
    )
    expect((await loadTradeFairnessWatchlist({ leagueId: 'L1', season: 2026 })).map((i) => i.tradeId)).toEqual(['now'])
  })
})

describe('getTradeFairnessByTradeId', () => {
  it('finds a trade by its transaction id, with the same canonical grade', async () => {
    loadGradedLeagueTradeRows.mockResolvedValue(loaded([[row('t1'), graded('B', 'D', 11)]]))
    expect(await getTradeFairnessByTradeId({ leagueId: 'L1', tradeId: 't1' })).toMatchObject({ letter: 'B', partnerLetter: 'D', imbalancePct: 11 })
  })

  it('maps an older client’s LeagueTrade.id onto its transaction id', async () => {
    loadGradedLeagueTradeRows.mockResolvedValue(loaded([[row('t1'), graded('B', 'D', 11)]]))
    leagueTradeFindFirst.mockResolvedValue({ transactionId: 't1' })
    expect(await getTradeFairnessByTradeId({ leagueId: 'L1', tradeId: 'cuid-row' })).toMatchObject({ tradeId: 't1', letter: 'B' })
  })
})
