import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { gradeSportTradeRows, loadSportTradeLedger, SPORT_LEDGER_MIN_DAYS, type SportLedgerRow } from '@/lib/chimmy-outcomes/sportTradeLedger'

/* The trade outcome check for the board-valued sports (owner's call, 2026-11-22): graded by date, not NFL weeks. */

const NOW = new Date('2026-11-22T12:00:00Z')
const DAY = 86_400_000
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const row = (letter: string, capturedIso: string, get: string[], give: string[]): SportLedgerRow =>
  ({ surface: 's', letter, format: 'redraft', fromWeek: 0, getPlayerIds: get, givePlayerIds: give, nonPlayerAssets: false, isTrade: true, capturedAtMs: Date.parse(capturedIso) })

describe('gradeSportTradeRows', () => {
  const games = new Map([
    ['g', [{ dayMs: day('2026-11-01'), points: 50 }, { dayMs: day('2026-11-02'), points: 40 }, { dayMs: day('2026-11-05'), points: 30 }]],
    ['x', [{ dayMs: day('2026-11-02'), points: 10 }, { dayMs: day('2026-11-06'), points: 20 }]],
  ])

  it('counts only games on days after the grade; A held up when its side out-scored what it gave', () => {
    // Graded mid-day on the 1st: the game that day is not "after". g: 40+30 = 70, x: 10+20 = 30 → +40.
    const r = gradeSportTradeRows('NBA', [row('A', '2026-11-01T18:00:00Z', ['g'], ['x'])], games, NOW)
    expect(r).toMatchObject({ scored: 1, pending: 0, unscored: 0 })
    expect(r.byLetter.A).toEqual({ n: 1, netPoints: 40, ahead: 1, behind: 0, held: 1, decided: 1 })
  })

  it('F held up when its side was out-scored; C decides nothing; too recent is pending; no player in the feed is unscored', () => {
    const recent = new Date(NOW.getTime() - (SPORT_LEDGER_MIN_DAYS - 1) * DAY).toISOString()
    const r = gradeSportTradeRows('NBA', [
      row('F', '2026-11-01T18:00:00Z', ['x'], ['g']),
      row('C', '2026-11-01T18:00:00Z', ['g'], ['x']),
      row('A', recent, ['g'], ['x']),
      row('B', '2026-11-01T18:00:00Z', ['nobody'], ['x']),
    ], games, NOW)
    expect(r.byLetter.F).toMatchObject({ held: 1, decided: 1, behind: 1 })
    expect(r.byLetter.C).toMatchObject({ n: 1, decided: 0 })
    expect(r).toMatchObject({ pending: 1, unscored: 1, scored: 2 })
  })
})

describe('loadSportTradeLedger', () => {
  it('reads the sport\'s grades once per deal and its game points, and says how many ids it placed', async () => {
    const receipt = { grade: { graded: true, letter: 'B', leagueType: { type: 'redraft' } }, canonical: { proposerRosterId: 'r1', moves: [{ playerId: 'g', fromRosterId: 'r2', toRosterId: 'r1' }, { playerId: 'zz', fromRosterId: 'r1', toRosterId: 'r2' }] }, assets: [] }
    const calls: string[] = []
    const db = {
      $queryRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
        const sql = q.join('?')
        calls.push(sql)
        if (sql.includes('trade_decision_snapshots')) {
          expect(v).toContain('NBA')
          return [{ is_trade: true, surface: 'proposal', captured_at: new Date('2026-11-01T18:00:00Z'), receipt }]
        }
        return [{ pid: 'g', day: new Date('2026-11-03T00:00:00Z'), p: 44 }]
      }),
    }
    const out = await loadSportTradeLedger('NBA', { db: db as never, now: NOW })
    expect(calls[0]).toContain('DISTINCT ON')
    expect(out).toMatchObject({ read: 1, gradable: 1, idsTotal: 2, idsPlaced: 1 })
    // One side's player is not in the feed at all: unscored, never scored as zero.
    expect(out.result).toMatchObject({ scored: 0, unscored: 1 })
  })
})
