import { describe, expect, it } from 'vitest'

import {
  gapDistribution,
  loadTradeMarketContext,
  marketContextLines,
  resetGapDistributionMemo,
  tradeFactsFrom,
} from '@/lib/integrity/tradeMarketContext'
import { resetLearnedTablesMemo, type LearnedTables } from '@/lib/trade-market/learnedInGrades'

/*
 * The market beside a reviewed trade (owner's call, 2026-11-22): how unusual the gap is, each side's record at the trade,
 * and what the pick market says — facts, never a verdict.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const row = { sideAName: 'Gridiron', sideBName: 'Waivers', gapPct: 47 }
const dist = gapDistribution([{ bucket: 0, count: 600 }, { bucket: 2, count: 300 }, { bucket: 9, count: 60 }, { bucket: 12, count: 40 }])
const tables: LearnedTables = {
  picks: new Map([['DYNASTY:SUPERFLEX', [{ key: '1:0', published: true, value: 4600, prior: 4000, trades: 88 }] as never]]),
  need: new Map(),
  posture: new Map(),
}

describe('how unusual the gap is', () => {
  it('the share at or above the gap, stated at its 5-point floor', () => {
    const lines = marketContextLines({ row, facts: null, distribution: dist, tables: null })
    expect(lines).toEqual(['10% of 1,000 audited trades on AllFantasy had a value gap of 45% or more.'])
  })

  it('not stated on too few audited trades, or for an even trade', () => {
    expect(marketContextLines({ row, facts: null, distribution: gapDistribution([{ bucket: 9, count: 10 }]), tables: null })).toEqual([])
    expect(marketContextLines({ row: { ...row, gapPct: 3 }, facts: null, distribution: dist, tables: null })).toEqual([])
  })
})

describe('the trade facts', () => {
  const snapshot = { sides: [{ rosterId: '1', record: { wins: 7, losses: 2, ties: 0 } }, { rosterId: '2', record: { wins: 2, losses: 6, ties: 1 } }] }
  const rows = [
    // Side A's row (its partner is side B, roster 2): A sent a 2027 1st.
    { transactionId: 't', tradeDate: new Date('2026-10-20T12:00:00Z'), partnerRosterId: 2, picksGiven: [{ season: 2027, round: 1 }], picksReceived: [], contextSnapshot: snapshot, leagueFormat: 'dynasty', isSuperFlex: true },
    { transactionId: 't', tradeDate: new Date('2026-10-20T12:00:00Z'), partnerRosterId: 1, picksGiven: [], picksReceived: [{ season: 2027, round: 1 }], contextSnapshot: null, leagueFormat: 'dynasty', isSuperFlex: true },
  ]

  it('records, oriented to the audit sides, and the pick market on what each side sent', () => {
    const facts = tradeFactsFrom(rows, '1', '2', 12)!
    expect(facts).toMatchObject({ book: 'DYNASTY:SUPERFLEX', dynasty: true, a: { picksSent: [{ season: 2027, round: 1 }] }, b: { picksSent: [] } })
    const lines = marketContextLines({ row, facts, distribution: null, tables })
    expect(lines[0]).toBe('At the trade, Gridiron was 7-2 (.778) and Waivers was 2-6-1 (.278).')
    expect(lines[1]).toMatch(/^Gridiron sent a 2027 1st: AllFantasy pick market \+15%.*88 completed trades/)
  })

  it('swapped sides swap the records; only one side stored still reads the picks it sent', () => {
    const facts = tradeFactsFrom(rows, '2', '1', 12)!
    expect(marketContextLines({ row, facts, distribution: null, tables: null })[0]).toMatch(/Gridiron was 2-6-1.*Waivers was 7-2/)
    const onlyB = tradeFactsFrom([rows[1]!], '1', '2', 12)!
    expect(onlyB.a!.picksSent).toEqual([{ season: 2027, round: 1 }])
  })

  it('nothing is guessed: no saved context, no records; a redraft trade, no pick line', () => {
    const bare = rows.map((r) => ({ ...r, contextSnapshot: null }))
    expect(marketContextLines({ row, facts: tradeFactsFrom(bare, '1', '2', 12), distribution: null, tables })).toHaveLength(1)
    const redraft = rows.map((r) => ({ ...r, leagueFormat: 'redraft' }))
    // Even if a redraft book somehow carried pick classes, a redraft trade gets no pick line.
    const withRedraft = { ...tables, picks: new Map([...tables.picks, ['REDRAFT:SUPERFLEX', tables.picks.get('DYNASTY:SUPERFLEX')!]]) }
    expect(marketContextLines({ row, facts: tradeFactsFrom(redraft, '1', '2', 12), distribution: null, tables: withRedraft })).toHaveLength(1)
    expect(tradeFactsFrom([], '1', '2', 12)).toBeNull()
  })
})

describe('loading', () => {
  it('reads each trade once by id, and a failing read costs only its own part', async () => {
    resetGapDistributionMemo()
    resetLearnedTablesMemo()
    const asked: unknown[] = []
    const db = {
      leagueTrade: { findMany: async (a: unknown) => { asked.push(a); throw new Error('down') } },
      $queryRaw: async () => [{ bucket: 9, count: 100 }, { bucket: 0, count: 900 }],
      sportsDataCache: { findUnique: async () => null },
    }
    const audit = [{ tradeKey: 'sleeper:t', sideATeamId: '1', sideBTeamId: '2', sideAName: 'A', sideBName: 'B', sideAGave: [], sideBGave: [], sideAValue: 1, sideBValue: 2, gapPct: 47, basis: 'trade_date', completedAt: null },
      { tradeKey: 'af:x', sideATeamId: '1', sideBTeamId: '2', sideAName: 'A', sideBName: 'B', sideAGave: [], sideBGave: [], sideAValue: 1, sideBValue: 1, gapPct: 0, basis: 'at_completion', completedAt: null }]
    const out = await loadTradeMarketContext(db as never, audit, { teams: 12, now: NOW })
    expect(out['sleeper:t']).toEqual(['10% of 1,000 audited trades on AllFantasy had a value gap of 45% or more.'])
    expect(out['af:x']).toBeUndefined()
    expect(JSON.stringify(asked[0])).toContain('"in":["t"]')
  })
})
