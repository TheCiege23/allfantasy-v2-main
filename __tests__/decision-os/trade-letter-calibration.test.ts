import { describe, expect, it, vi } from 'vitest'

/**
 * Trade OS, 2026-11-21 (owner's "build Trade OS out to 100%"): the trade grade learns how sure to be from its own
 * graded deals. A letter's confidence comes from how deals graded that letter turned out; the letter never changes.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const {
  letterHeldUp,
  foldTradeLetterCalls,
  tradeLetterCalibrationFrom,
  tradeLetterConfidence,
  readTradeLetterCalibration,
  TRADE_CONFIDENCE_MIN_SAMPLE,
} = await import('@/lib/decision-os/trade/letterCalibration')
const { gradeTradeRows } = await import('@/lib/decision-os/trade/tradeLedger')
const { foldLedger, weekCalendar, ledgerRecordFor, readLedgerRecordView } = await import('@/lib/chimmy-outcomes/ledgerRecord')
const { tradeLetterRecord, commissionerLetterRecord, renderEngineRecordPromptLine } = await import('@/lib/chimmy-outcomes/engineRecord')
const { adviceRecordMessages } = await import('@/lib/core-app/messages/adviceRecord')

const calls = (n: number, letter: string, netPerWeek: number, ageDays = 0) => Array.from({ length: n }, () => ({ letter, netPerWeek, ageDays }))

describe('which way a letter promises', () => {
  it('A and B hold up when the graded side out-scored; D and F when it was out-scored; C and ties decide nothing', () => {
    expect(letterHeldUp('A', 3)).toBe(true)
    expect(letterHeldUp('B', -1)).toBe(false)
    expect(letterHeldUp('D', -2)).toBe(true)
    expect(letterHeldUp('F', 4)).toBe(false)
    expect(letterHeldUp('C', 5)).toBeNull()
    expect(letterHeldUp('A', 0)).toBeNull()
    expect(letterHeldUp('A+', 1)).toBe(true)
    expect(letterHeldUp('Z', 1)).toBeNull()
    expect(letterHeldUp('A', Number.NaN)).toBeNull()
  })
})

describe('the record', () => {
  it('🛑 says nothing until a letter has enough DECIDED deals — a tie and a C decide nothing', () => {
    const under = foldTradeLetterCalls([...calls(TRADE_CONFIDENCE_MIN_SAMPLE - 1, 'A', 2), ...calls(30, 'A', 0), ...calls(40, 'C', 3)])
    expect(under.A).toMatchObject({ held: TRADE_CONFIDENCE_MIN_SAMPLE - 1, missed: 0 })
    expect((under as Record<string, unknown>).C).toBeUndefined()
    expect(tradeLetterCalibrationFrom(under)).toBeNull()
    const enough = foldTradeLetterCalls(calls(TRADE_CONFIDENCE_MIN_SAMPLE, 'A', 2))
    expect(tradeLetterCalibrationFrom(enough)?.A?.decided).toBe(TRADE_CONFIDENCE_MIN_SAMPLE)
  })

  it('shrinks toward a coin flip: 20 of 20 held up reads 75%, not 100%', () => {
    const cal = tradeLetterCalibrationFrom(foldTradeLetterCalls(calls(20, 'B', 1.5)))
    expect(cal?.B?.heldRate).toBeCloseTo((20 + 0.5 * 20) / (20 + 20), 6)
  })

  it('an F that was out-scored HELD UP; one that out-scored did not', () => {
    const cal = tradeLetterCalibrationFrom(foldTradeLetterCalls([...calls(30, 'F', -3), ...calls(10, 'F', 2)]))
    expect(cal?.F?.heldRate).toBeCloseTo((30 + 10) / (40 + 20), 6)
  })

  it('old deals weigh less than recent ones', () => {
    const fresh = tradeLetterCalibrationFrom(foldTradeLetterCalls([...calls(20, 'A', 2), ...calls(20, 'A', -2, 120)]))
    const stale = tradeLetterCalibrationFrom(foldTradeLetterCalls([...calls(20, 'A', 2, 120), ...calls(20, 'A', -2)]))
    expect(fresh!.A!.heldRate).toBeGreaterThan(0.5)
    expect(stale!.A!.heldRate).toBeLessThan(0.5)
  })

  it('levels: high at 70%, medium at 55%, low below; C never has one', () => {
    const at = (rate: number) => tradeLetterConfidence('A', { A: { heldRate: rate, decided: 40 } })?.level
    expect(at(0.7)).toBe('high')
    expect(at(0.69)).toBe('medium')
    expect(at(0.55)).toBe('medium')
    expect(at(0.54)).toBe('low')
    expect(tradeLetterConfidence('C', { A: { heldRate: 0.9, decided: 40 } })).toBeNull()
    expect(tradeLetterConfidence('B', { A: { heldRate: 0.9, decided: 40 } })).toBeNull()
    expect(tradeLetterConfidence('A-', { A: { heldRate: 0.81, decided: 40 } })).toEqual({ letter: 'A', heldPct: 81, decided: 40, level: 'high' })
  })

  it('a malformed calibration from the wire reads as none, letter by letter', () => {
    expect(readTradeLetterCalibration(null)).toBeNull()
    expect(readTradeLetterCalibration({ A: { heldRate: 2, decided: 40 } })).toBeNull()
    expect(readTradeLetterCalibration({ A: { heldRate: 0.6, decided: 0 } })).toBeNull()
    expect(readTradeLetterCalibration({ A: { heldRate: 0.6, decided: 40 }, B: { heldRate: 'x' } })).toEqual({ A: { heldRate: 0.6, decided: 40 } })
  })
})

describe('the ledger grades deals into it', () => {
  it('gradeTradeRows hands back each scored row with its net, and never a pending or unplaced one', () => {
    const row = (letter: string, fromWeek: number, get: string[], give: string[]) => ({
      surface: 's', letter, format: 'redraft' as const, fromWeek, getPlayerIds: get, givePlayerIds: give, nonPlayerAssets: false, isTrade: true,
    })
    const points = (ids: readonly string[]) => (ids.includes('NOPE') ? null : ids.length * 10)
    const out = gradeTradeRows([row('A', 3, ['G1', 'G2'], ['X1']), row('B', 12, ['G1'], ['X1']), row('D', 3, ['NOPE'], ['X1'])], 9, points)
    expect(out.scored).toEqual([{ row: expect.objectContaining({ letter: 'A' }), netPerWeek: 10 }])
    expect(out.pending).toBe(1)
    expect(out.unscored).toBe(1)
  })

  it('the snapshot carries the letters, and the view states each letter’s confidence beside its record', () => {
    const cal = weekCalendar([])
    const trades = { byLetter: { A: { n: 40, netPerWeek: 2.1, ahead: 30, behind: 10 } }, pending: 0, unscored: 0, read: 40, gradable: 40 }
    const tradeLetters = foldTradeLetterCalls([...calls(30, 'A', 2), ...calls(10, 'A', -2)])
    const snap = foldLedger({ season: 2026, cal, now: new Date('2026-11-21T00:00:00Z'), bench: [], adds: [], trades, tradeLetters })
    expect(snap.tradeLetters?.A).toMatchObject({ held: 30, missed: 10 })
    const view = ledgerRecordFor(snap, null)
    expect(view?.tradeConfidence?.A?.decided).toBe(40)
    // It survives the trip to the client.
    const back = readLedgerRecordView(JSON.parse(JSON.stringify(view)))
    const rec = tradeLetterRecord(back, 'A')
    expect(rec?.confidence).toEqual({ letter: 'A', heldPct: Math.round(((30 + 10) / 60) * 100), decided: 40, level: 'medium' })
    // 🛑 The letter and its raw record are untouched.
    expect(rec).toMatchObject({ letter: 'A', n: 40, netPerWeek: 2.1, verdict: 'held_up' })
  })

  it('an old snapshot with no letters reads exactly as before', () => {
    const cal = weekCalendar([])
    const trades = { byLetter: { A: { n: 40, netPerWeek: 2.1, ahead: 30, behind: 10 } }, pending: 0, unscored: 0, read: 40, gradable: 40 }
    const snap = foldLedger({ season: 2026, cal, now: new Date(), bench: [], adds: [], trades })
    expect('tradeLetters' in snap).toBe(false)
    expect(tradeLetterRecord(ledgerRecordFor(snap, null), 'A')?.confidence).toBeNull()
  })

  it('the commissioner review takes the commissioners’ own confidence with their own record', () => {
    const view = {
      season: 2026,
      bench: null,
      pickups: null,
      trades: [{ letter: 'B' as const, n: 50, netPerWeek: 1, aheadPct: 60 }],
      commissionerTrades: [{ letter: 'B' as const, n: 25, netPerWeek: 2, aheadPct: 70 }],
      tradeConfidence: { B: { heldRate: 0.6, decided: 50 } },
      commissionerTradeConfidence: { B: { heldRate: 0.8, decided: 25 } },
    }
    expect(commissionerLetterRecord(view, 'B')).toMatchObject({ scope: 'commissioner', confidence: { heldPct: 80, level: 'high' } })
    const everyone = commissionerLetterRecord({ ...view, commissionerTrades: null, commissionerTradeConfidence: null }, 'B')
    expect(everyone).toMatchObject({ scope: 'everyone', confidence: { heldPct: 60, level: 'medium' } })
  })
})

describe('what people and Chimmy are told', () => {
  const view = {
    season: 2026,
    bench: null,
    pickups: null,
    trades: [
      { letter: 'A' as const, n: 40, netPerWeek: 2.1, aheadPct: 75 },
      { letter: 'C' as const, n: 30, netPerWeek: 0.2, aheadPct: 50 },
    ],
    tradeConfidence: { A: { heldRate: 0.72, decided: 40 } },
  }

  it('Chimmy gets the confidence beside the letter, and the rule that it never changes the letter', () => {
    const line = renderEngineRecordPromptLine(view)
    expect(line).toContain('how sure a A is: high (about 72% of its deals held up — 40 decided')
    expect(line).not.toContain('how sure a C')
    expect(line).toContain('It never changes the letter')
  })

  it('the Trade Center line, in English and Spanish, warns on a low one', () => {
    expect(adviceRecordMessages.en.tradeConfidence('A', 'high', 72, 40)).toBe(
      'How sure this A is: High. About 72% of our A grades on redraft trades have held up (40 decided, recent ones weighted more).',
    )
    expect(adviceRecordMessages.en.tradeConfidence('B', 'low', 48, 30)).toContain('closer than the letter suggests')
    expect(adviceRecordMessages.es.tradeConfidence('A', 'medium', 60, 40)).toContain('Qué tan segura es esta A: Media.')
    expect(adviceRecordMessages.es.tradeConfidence('A', 'medium', 60, 40).toLowerCase()).not.toContain('waiver')
  })
})

describe('the six-hourly rebuild folds graded deals into the letters', () => {
  it('a season of A deals whose side out-scored what it gave reaches the snapshot as held up', async () => {
    const { recomputeLedgerRecord } = await import('@/lib/chimmy-outcomes/ledgerGrading')
    const week = (w: number) => new Date(Date.UTC(2026, 8, 10 + 7 * (w - 1), 17))
    const receipt = {
      grade: { graded: true, letter: 'A', leagueType: { type: 'redraft' } },
      canonical: { proposerRosterId: 'R1', moves: [{ playerId: 'G1', fromRosterId: 'R2', toRosterId: 'R1' }, { playerId: 'X1', fromRosterId: 'R1', toRosterId: 'R2' }] },
      assets: [],
    }
    const db = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?')
        if (sql.includes('FROM "SportsGame"')) return Array.from({ length: 10 }, (_, i) => ({ week: i + 1, first: week(i + 1), last: week(i + 1) }))
        if (sql.includes('trade_decision_snapshots')) {
          return Array.from({ length: 25 }, () => ({ is_trade: true, completed: true, surface: 'trade-center', captured_at: new Date(Date.UTC(2026, 8, 12)), receipt }))
        }
        if (sql.includes('player_game_stats')) {
          return [2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((wk) => [{ pid: 'G1', wk, p: 15 }, { pid: 'X1', wk, p: 10 }])
        }
        return []
      }),
      sportsPlayer: { findMany: vi.fn(async () => []) },
    }
    const snap = await recomputeLedgerRecord({ now: new Date('2026-11-21T12:00:00Z'), db: db as never })
    expect(snap?.trades.byLetter.A).toMatchObject({ n: 25, ahead: 25 })
    expect(snap?.tradeLetters?.A).toMatchObject({ held: 25, missed: 0 })
    expect(snap!.tradeLetters!.A!.wDecided).toBeGreaterThan(0)
    expect(snap!.tradeLetters!.A!.wDecided).toBeLessThan(25)
    // Every one held up, but they are ten weeks old: decayed, they weigh less than the coin-flip prior's 20 deals.
    const w = snap!.tradeLetters!.A!.wDecided
    const conf = tradeLetterRecord(ledgerRecordFor(snap, null), 'A')?.confidence
    expect(conf).toEqual({ letter: 'A', decided: 25, heldPct: Math.round(((w + 10) / (w + 20)) * 100), level: 'medium' })
  })
})
