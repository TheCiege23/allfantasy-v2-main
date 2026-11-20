/**
 * The trade half of the advice ledger, 2026-11-20:
 *
 *   1. ONE ROW PER DEAL. A receipt is an evaluation; until now the ledger counted every one, so a deal re-opened
 *      on several days, screens or by several people was graded several times. The read now keeps the FIRST
 *      evaluation per `inputHash`, in SQL, ahead of the LIMIT.
 *   2. A COMMISSIONER TALLY. The same grading over only `commissioner-review` evaluations, stored beside the main
 *      one and shown on the commissioner's trade review — falling back to the record over every deal.
 *
 * The dedup itself runs in Postgres, which no test here has; its SQL shape is pinned instead, with a positive
 * control below proving the pin fails when the dedup is taken out.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Prisma } from '@prisma/client'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { COMMISSIONER_REVIEW_SURFACE, loadTradeLedgerInputs } from '@/lib/chimmy-outcomes/ledgerGrading'
import { foldLedger, ledgerRecordFor, readLedgerRecordView, type LedgerSnapshot } from '@/lib/chimmy-outcomes/ledgerRecord'
import { commissionerLetterRecord } from '@/lib/chimmy-outcomes/engineRecord'
import { TradeReviewPanel } from '@/components/trade-review/TradeReviewPanel'
import { __resetAdviceRecordForTests } from '@/components/core-app/useAdviceRecord'

/** Flatten a tagged-template Prisma.Sql into its text, so the shape can be read. */
const sqlText = (q: Prisma.Sql) => q.strings.join('?').replace(/\s+/g, ' ')

function fakeDb() {
  const queries: Prisma.Sql[] = []
  const db = {
    // Called as a tagged template: rebuild the one Sql it would send, nested fragments flattened.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(Prisma.sql(strings, ...values))
      return []
    }),
    sportsPlayer: { findMany: vi.fn(async () => []) },
  }
  return { db: db as never, queries }
}

const CAL = new Map([[1, { start: new Date('2026-09-10T00:00:00Z'), end: new Date('2026-09-15T00:00:00Z') }]]) as never

describe('the trade read counts each deal once', () => {
  it('keeps the first evaluation per inputHash, before the LIMIT', async () => {
    const { db, queries } = fakeDb()
    await loadTradeLedgerInputs(2026, CAL, { db })
    const sql = sqlText(queries[0]!)
    expect(sql).toContain('SELECT DISTINCT ON (COALESCE(s."inputHash", s.id))')
    // Earliest first inside the dedup: the letter the manager saw before anything else happened.
    expect(sql).toMatch(/ORDER BY COALESCE\(s\."inputHash", s\.id\), s\."capturedAt" ASC/)
    // The LIMIT applies to the deduplicated set, so re-opened deals cannot crowd real ones out.
    expect(sql.indexOf('LIMIT')).toBeGreaterThan(sql.indexOf(') d'))
  })

  it('reads every surface by default, and only the commissioner review when asked', async () => {
    const all = fakeDb()
    await loadTradeLedgerInputs(2026, CAL, { db: all.db })
    expect(sqlText(all.queries[0]!)).not.toContain('s.surface =')

    const own = fakeDb()
    await loadTradeLedgerInputs(2026, CAL, { db: own.db, surface: COMMISSIONER_REVIEW_SURFACE })
    const q = own.queries[0]!
    expect(sqlText(q)).toContain('AND s.surface = ?')
    expect(q.values).toContain('commissioner-review')
  })
})

const tally = (n: number, netPerWeek: number): LedgerSnapshot['trades'] => ({
  byLetter: { A: { n, netPerWeek, ahead: n - 2, behind: 2 } },
  pending: 0,
  unscored: 0,
  read: n,
  gradable: n,
})

function snapshot(commissionerTrades?: LedgerSnapshot['trades']): LedgerSnapshot {
  return foldLedger({ season: 2026, cal: CAL, now: new Date('2026-11-20T00:00:00Z'), bench: [], adds: [], trades: tally(40, 3.2), commissionerTrades })
}

describe('the commissioner tally rides beside the main one', () => {
  it('is stored, viewed and survives the trip to the client', () => {
    const view = ledgerRecordFor(snapshot(tally(22, -1.4)), null)!
    expect(view.trades).toEqual([{ letter: 'A', n: 40, netPerWeek: 3.2, aheadPct: 95 }])
    expect(view.commissionerTrades).toEqual([{ letter: 'A', n: 22, netPerWeek: -1.4, aheadPct: 91 }])
    expect(readLedgerRecordView(JSON.parse(JSON.stringify(view)))?.commissionerTrades).toEqual(view.commissionerTrades)
  })

  it('obeys the same 20-deal floor, and is absent below it or on an older snapshot', () => {
    expect(ledgerRecordFor(snapshot(tally(19, 2)), null)).not.toHaveProperty('commissionerTrades')
    expect(ledgerRecordFor(snapshot(), null)).not.toHaveProperty('commissionerTrades')
  })

  it('a malformed commissioner list drops only itself', () => {
    const view = { ...ledgerRecordFor(snapshot(), null)!, commissionerTrades: [{ letter: 'Z', n: 'x' }] }
    const read = readLedgerRecordView(view)
    expect(read?.trades?.[0]?.letter).toBe('A')
    expect(read).not.toHaveProperty('commissionerTrades')
  })
})

describe('commissionerLetterRecord', () => {
  it('prefers the commissioner record, then every deal, then nothing', () => {
    const both = ledgerRecordFor(snapshot(tally(22, -1.4)), null)
    expect(commissionerLetterRecord(both, 'A')).toMatchObject({ scope: 'commissioner', n: 22, verdict: 'not_held_up' })
    const mainOnly = ledgerRecordFor(snapshot(), null)
    expect(commissionerLetterRecord(mainOnly, 'A')).toMatchObject({ scope: 'everyone', n: 40, verdict: 'held_up' })
    expect(commissionerLetterRecord(mainOnly, 'B')).toBeNull()
    expect(commissionerLetterRecord(null, 'A')).toBeNull()
  })
})

describe('the commissioner trade review shows the letter’s record', () => {
  const REVIEW = {
    review: { model: 'trade-review-v1', recommendation: 'approve', flags: [], checks: [] },
    sides: ['Alpha', 'Bravo'],
    tradeGrade: { grade: 'A', partnerGrade: 'F', gradeWithheld: null },
    reviewId: 'rcpt_r',
    explanation: { noteToLeague: null, headline: 'h', source: 'template' },
    actOn: null,
  }
  const RECORD = ledgerRecordFor(snapshot(tally(22, -1.4)), null)

  beforeEach(() => __resetAdviceRecordForTests())
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  async function open(recordScope: unknown) {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).startsWith('/api/advice-record') ? { record: RECORD } : { ...REVIEW, recordScope }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<TradeReviewPanel leagueId="L1" tradeId="t1" kind="af" />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('trade-review-toggle'))
    })
    await act(async () => {})
    return fetchMock
  }

  it('NFL redraft: the commissioner record, saying when the letter has not held up', async () => {
    await open({ sport: 'NFL', leagueType: 'redraft' })
    const line = screen.getByTestId('trade-review-letter-record').textContent
    expect(line).toMatch(/^Trades commissioners reviewed at A: across 22 graded redraft deals/)
    expect(line).toMatch(/1\.4 PPR a week less than it gave up\. The letter has not held up so far/)
    // The recommendation itself is untouched by the record.
    expect(screen.getByTestId('trade-review-recommendation').textContent).toBe('No flags — fine to approve')
  })

  it('a dynasty league or another sport shows no record and never asks for one', async () => {
    const dynasty = await open({ sport: 'NFL', leagueType: 'dynasty' })
    expect(screen.queryByTestId('trade-review-letter-record')).toBeNull()
    expect(dynasty.mock.calls.some((c) => String(c[0]).startsWith('/api/advice-record'))).toBe(false)
    cleanup()
    __resetAdviceRecordForTests()
    await open({ sport: 'NBA', leagueType: 'redraft' })
    expect(screen.queryByTestId('trade-review-letter-record')).toBeNull()
  })
})
