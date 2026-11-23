import { describe, expect, it } from 'vitest'
import {
  fantraxCsvTradeSide,
  parseFantraxEasternDate,
  parseFantraxTradeHistoryCsv,
  readCsvRows,
  stripFantraxStandingPrefix,
  WRONG_EXPORT_ERROR,
} from '@/lib/league-import/fantrax/fantraxTradeHistoryCsv'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

/**
 * Fantrax "Transaction History → Trade" export. The shape (columns, pick and budget lines, the "#N " prefix, a Week
 * column that disagrees within one afternoon) is copied from a real export; every team name here is invented.
 */
const HEADER = '"Player","Team","Position","From","To","# Obj","Date (EST)","Week"'
const EXPORT = [
  HEADER,
  '"2027 Draft Pick, Round 1 (#27 Harbor Owls)","","","#27 Harbor Owls","#9 Mesa Comets","0","Mon Nov 16, 2026, 7:57PM","10"',
  '"2028 Draft Pick, Round 4 (#27 Harbor Owls)","","","#27 Harbor Owls","#9 Mesa Comets","0","Mon Nov 16, 2026, 7:57PM","10"',
  '"Budget Amount: $5000.00","","","#27 Harbor Owls","#9 Mesa Comets","0","Mon Nov 16, 2026, 7:57PM","10"',
  '"Quarterback One","PHI","SFX","#9 Mesa Comets","#27 Harbor Owls","0","Mon Nov 16, 2026, 7:57PM","10"',
  '"2028 Draft Pick, Round 4 (#18 Lake Herons)","","","#18 Lake Herons","#9 Mesa Comets","0","Mon Nov 16, 2026, 4:26PM","11"',
  '"2027 Draft Pick, Round 2 (#18 Lake Herons)","","","#18 Lake Herons","#9 Mesa Comets","0","Mon Nov 16, 2026, 4:26PM","11"',
  '"Quarterback Two","IND","SFX","#9 Mesa Comets","#18 Lake Herons","0","Mon Nov 16, 2026, 4:26PM","11"',
  '"Receiver Three","WAS","WR","#1 Pine Bears","#11 Dune Foxes","0","Wed Nov 11, 2026, 4:49PM","10"',
  '"Corner Four","PIT","CB","#1 Pine Bears","#11 Dune Foxes","0","Wed Nov 11, 2026, 4:49PM","10"',
  '"Back Five","LAR","RB","#11 Dune Foxes","#1 Pine Bears","0","Wed Nov 11, 2026, 4:49PM","10"',
  '',
].join('\n')

describe('parseFantraxTradeHistoryCsv', () => {
  it('rebuilds one trade per accepted deal, newest first, with every asset and both sides', () => {
    const r = parseFantraxTradeHistoryCsv(EXPORT)
    if (!r.ok) throw new Error(r.error)
    expect(r.skipped).toEqual([])
    expect(r.trades.map((t) => t.teams)).toEqual([
      ['#27 Harbor Owls', '#9 Mesa Comets'],
      ['#18 Lake Herons', '#9 Mesa Comets'],
      ['#1 Pine Bears', '#11 Dune Foxes'],
    ])
    const [first] = r.trades
    // Labels are kept as written: the "#N" can be part of a team's name (see the module header).
    expect(fantraxCsvTradeSide(first, '#9 Mesa Comets')).toEqual({
      received: [
        { kind: 'pick', season: 2027, round: 1, originalOwner: '#27 Harbor Owls' },
        { kind: 'pick', season: 2028, round: 4, originalOwner: '#27 Harbor Owls' },
        { kind: 'budget', amount: 5000 },
      ],
      gave: [{ kind: 'player', name: 'Quarterback One', proTeam: 'PHI', position: 'SFX' }],
    })
    expect(fantraxCsvTradeSide(first, '#27 Harbor Owls').received).toEqual([{ kind: 'player', name: 'Quarterback One', proTeam: 'PHI', position: 'SFX' }])
    expect(r.trades[2].moves).toHaveLength(3)
  })

  it('reads the Eastern wall clock as UTC (EST in November)', () => {
    const r = parseFantraxTradeHistoryCsv(EXPORT)
    if (!r.ok) throw new Error(r.error)
    expect(r.trades[0].tradeDate.toISOString()).toBe('2026-11-17T00:57:00.000Z')
    expect(r.trades[0].dateText).toBe('Mon Nov 16, 2026, 7:57PM')
  })

  it('keeps the week but never trusts it across trades (two trades the same afternoon say 10 and 11)', () => {
    const r = parseFantraxTradeHistoryCsv(EXPORT)
    if (!r.ok) throw new Error(r.error)
    expect(r.trades.map((t) => t.week)).toEqual([10, 11, 10])
  })

  it('two unrelated trades accepted in the same minute stay two trades', () => {
    const csv = [
      HEADER,
      '"Player A","KC","RB","#1 Pine Bears","#2 Dune Foxes","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Player B","BUF","WR","#2 Dune Foxes","#1 Pine Bears","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Player C","SF","TE","#3 Lake Herons","#4 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Player D","DAL","QB","#4 Mesa Comets","#3 Lake Herons","0","Sun Oct 4, 2026, 1:00PM","5"',
    ].join('\r\n')
    const r = parseFantraxTradeHistoryCsv(csv)
    if (!r.ok) throw new Error(r.error)
    expect(r.trades).toHaveLength(2)
    expect(r.trades.map((t) => [...t.teams].sort()).sort()).toEqual([['#1 Pine Bears', '#2 Dune Foxes'], ['#3 Lake Herons', '#4 Mesa Comets']])
  })

  it('a three-team trade is one trade', () => {
    const csv = [
      HEADER,
      '"Player A","KC","RB","#1 Pine Bears","#2 Dune Foxes","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Player B","BUF","WR","#2 Dune Foxes","#3 Lake Herons","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Player C","SF","TE","#3 Lake Herons","#1 Pine Bears","0","Sun Oct 4, 2026, 1:00PM","5"',
    ].join('\n')
    const r = parseFantraxTradeHistoryCsv(csv)
    if (!r.ok) throw new Error(r.error)
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0].teams).toEqual(['#1 Pine Bears', '#2 Dune Foxes', '#3 Lake Herons'])
  })

  it('the same export gives the same ids, in any row order; a different trade gets a different id', () => {
    const a = parseFantraxTradeHistoryCsv(EXPORT)
    const lines = EXPORT.trim().split('\n')
    const b = parseFantraxTradeHistoryCsv([lines[0], ...lines.slice(1).reverse()].join('\n'))
    if (!a.ok || !b.ok) throw new Error('parse failed')
    expect(b.trades.map((t) => t.transactionId)).toEqual(a.trades.map((t) => t.transactionId))
    expect(new Set(a.trades.map((t) => t.transactionId)).size).toBe(3)
    for (const t of a.trades) {
      expect(t.transactionId).toMatch(/^fantrax-csv:[0-9a-f]{24}$/)
      expect(t.transactionId.length).toBeLessThanOrEqual(64)
    }
  })

  it('a row it cannot read is reported with its line, not dropped', () => {
    const csv = [
      HEADER,
      '"Player A","KC","RB","#1 Pine Bears","#2 Dune Foxes","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Player B","BUF","WR","","#1 Pine Bears","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Player C","SF","TE","#1 Pine Bears","#2 Dune Foxes","0","yesterday","5"',
      '"2027 Draft Pick (Round 1)","","","#1 Pine Bears","#2 Dune Foxes","0","Sun Oct 4, 2026, 1:00PM","5"',
    ].join('\n')
    const r = parseFantraxTradeHistoryCsv(csv)
    if (!r.ok) throw new Error(r.error)
    expect(r.trades).toHaveLength(1)
    expect(r.skipped.map((s) => s.line)).toEqual([3, 4, 5])
  })

  it('refuses a file that is not this export, naming what is missing', () => {
    expect(parseFantraxTradeHistoryCsv('')).toEqual({ ok: false, error: 'The file is empty.' })
    const r = parseFantraxTradeHistoryCsv('"Player","Team","Position","Status"\n"A","KC","RB","Active"')
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toContain('From, To, Date (EST)')
  })

  it('says a Claims/Drops export is the wrong file, and where to get the right one', () => {
    // The Claims/Drops export has every required column but From and To.
    const r = parseFantraxTradeHistoryCsv('"Player","Team","Position","Date (EST)","Week"\n"A","KC","RB","Sun Jul 5, 2026, 1:05PM","1"')
    expect(r).toEqual({ ok: false, error: WRONG_EXPORT_ERROR })
    expect(WRONG_EXPORT_ERROR).toMatch(/Claims\/Drops/)
    expect(WRONG_EXPORT_ERROR).toMatch(/choose Trades/)
    expect(WRONG_EXPORT_ERROR).not.toMatch(/missing column/)
    expect(hubCopy(WRONG_EXPORT_ERROR, 'es')).not.toBe(WRONG_EXPORT_ERROR)
    // Only that exact shape: one of the two missing, or a third, still lists the columns.
    const oneMissing = parseFantraxTradeHistoryCsv('"Player","Team","Position","From","Date (EST)"\n"A","KC","RB","X","d"')
    expect((oneMissing as { error: string }).error).toMatch(/missing column: To\.$/)
  })
})

describe('parseFantraxEasternDate', () => {
  it('applies daylight saving: EDT in summer, EST in winter, noon and midnight', () => {
    expect(parseFantraxEasternDate('Sun Jul 5, 2026, 1:05PM')?.toISOString()).toBe('2026-07-05T17:05:00.000Z')
    expect(parseFantraxEasternDate('Tue Dec 1, 2026, 12:00AM')?.toISOString()).toBe('2026-12-01T05:00:00.000Z')
    expect(parseFantraxEasternDate('Tue Dec 1, 2026, 12:30PM')?.toISOString()).toBe('2026-12-01T17:30:00.000Z')
    // The day the clocks go back: 3:00AM is EST.
    expect(parseFantraxEasternDate('Sun Nov 1, 2026, 3:00AM')?.toISOString()).toBe('2026-11-01T08:00:00.000Z')
  })

  it('refuses what is not a date', () => {
    for (const bad of ['', 'Feb 30, 2026, 1:00PM', 'Nov 16, 2026, 13:00PM', 'Nov 16 2026 7:57PM', '2026-11-16']) {
      expect(parseFantraxEasternDate(bad)).toBeNull()
    }
  })
})

describe('CSV helpers', () => {
  it('reads quoted commas, escaped quotes and a byte-order mark', () => {
    expect(readCsvRows('﻿"a, b","say ""hi""",c\n').map((r) => r.cells)).toEqual([['a, b', 'say "hi"', 'c']])
  })
  it('strips only the standings prefix', () => {
    expect(stripFantraxStandingPrefix('#27 Harbor Owls')).toBe('Harbor Owls')
    expect(stripFantraxStandingPrefix('Team #1 Fans')).toBe('Team #1 Fans')
  })
})
