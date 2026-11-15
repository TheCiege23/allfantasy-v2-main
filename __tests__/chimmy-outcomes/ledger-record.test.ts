import { describe, expect, it } from 'vitest'
import {
  addWindowEnd,
  completedThrough,
  firstWeekNotKickedOff,
  foldLedger,
  gradeStartSit,
  ledgerRecordFor,
  MIN_GRADED_FOR_OVERALL_RATE,
  MIN_TRADES_PER_LETTER,
  readLedgerRecordView,
  weekCalendar,
  weekIsOver,
  type AddRow,
  type BenchRow,
  type LedgerSnapshot,
} from '@/lib/chimmy-outcomes/ledgerRecord'

/*
 * AllFantasy's own track record (2026-11-15): My Team's bench check, the waiver panel's #1 pickup and
 * the trade grades, graded in the outcome snapshot. Nothing is graded before its week is provably over.
 */

const DAY = 86_400_000
// Week w: Thursday 00:20Z kickoff, Monday 01:15Z last kickoff (opener 2026-09-11).
const spans = Array.from({ length: 18 }, (_, i) => ({
  week: i + 1,
  firstKickoff: new Date(Date.UTC(2026, 8, 11, 0, 20) + i * 7 * DAY),
  lastKickoff: new Date(Date.UTC(2026, 8, 15, 1, 15) + i * 7 * DAY),
}))
const cal = weekCalendar(spans)
// Tuesday after week 10's Monday game.
const NOW = new Date(Date.UTC(2026, 10, 17, 12))

const noTrades: LedgerSnapshot['trades'] = { byLetter: {}, pending: 0, unscored: 0, read: 0, gradable: 0 }

describe('the week calendar', () => {
  it('a week is over 6h after its last kickoff, never before; an unknown week is never over', () => {
    const lastWk10 = spans[9]!.lastKickoff.getTime()
    expect(weekIsOver(cal, 10, new Date(lastWk10 + 5 * 3600_000))).toBe(false)
    expect(weekIsOver(cal, 10, new Date(lastWk10 + 6 * 3600_000))).toBe(true)
    expect(weekIsOver(weekCalendar(spans.filter((s) => s.week !== 4)), 4, NOW)).toBe(false)
  })

  it('completedThrough stops at the first week not over (a hole in the schedule stops it too)', () => {
    expect(completedThrough(cal, NOW)).toBe(10)
    expect(completedThrough(weekCalendar(spans.filter((s) => s.week !== 4)), NOW)).toBe(3)
    expect(completedThrough(cal, new Date(Date.UTC(2026, 8, 1)))).toBe(0)
  })

  it('firstWeekNotKickedOff: a trade evaluated the Wednesday before week 10 grades from week 10', () => {
    expect(firstWeekNotKickedOff(cal, new Date(Date.UTC(2026, 10, 11, 12)))).toBe(10)
    expect(firstWeekNotKickedOff(cal, new Date(Date.UTC(2026, 10, 13, 1)))).toBe(11)
    expect(firstWeekNotKickedOff(cal, new Date(Date.UTC(2026, 7, 20)))).toBe(1)
    expect(firstWeekNotKickedOff(cal, new Date(Date.UTC(2027, 0, 20)))).toBeNull()
  })

  it('a pickup window is three weeks and never runs past week 18', () => {
    expect(addWindowEnd(5)).toBe(7)
    expect(addWindowEnd(17)).toBe(18)
  })
})

describe('gradeStartSit', () => {
  it('within a point is "same" — the Receipts card rule — otherwise right or wrong', () => {
    expect(gradeStartSit(14.2, 13.4)).toBe('same')
    expect(gradeStartSit(14.2, 13.2)).toBe('right')
    expect(gradeStartSit(3, 12)).toBe('wrong')
  })
})

describe('foldLedger', () => {
  const bench = (over: Partial<BenchRow>): BenchRow => ({ userId: 'u1', week: 9, withdrawn: false, recPts: 18, altPts: 6, ...over })
  const add = (over: Partial<AddRow>): AddRow => ({ userId: 'u1', week: 6, recPts: 36, recWeeks: 3, altPts: 12, hasDrop: true, ...over })

  it('grades bench calls whose week is over; withdrawn, pending and unscored are counted, never graded', () => {
    const out = foldLedger({
      season: 2026,
      cal,
      now: NOW,
      bench: [
        bench({}),
        bench({ recPts: 4, altPts: 9, userId: 'u2' }),
        bench({ recPts: 10, altPts: 10.5 }),
        bench({ withdrawn: true }),
        bench({ week: 11 }),
        bench({ altPts: null }),
      ],
      adds: [],
      trades: noTrades,
    })
    expect(out.bench).toEqual({ right: 1, wrong: 1, same: 1, gain: 6.5, pending: 1, unscored: 1, withdrawn: 1 })
    expect(out.users.u1).toEqual({ b: [1, 0, 1] })
    expect(out.users.u2).toEqual({ b: [0, 1, 0] })
    expect(out.throughWeek).toBe(10)
  })

  it('grades a pickup once his whole window is over: startable at 10+ PPR/week, and against the drop', () => {
    const out = foldLedger({
      season: 2026,
      cal,
      now: NOW,
      bench: [],
      adds: [
        add({}), // 12/wk, beat the drop
        add({ recPts: 15, altPts: 30 }), // 5/wk, lost to the drop
        add({ hasDrop: false, altPts: null }), // no drop
        add({ week: 9 }), // window 9–11: week 11 not over
        add({ recWeeks: 0, recPts: null }), // no stat rows at all
      ],
      trades: noTrades,
    })
    expect(out.pickups).toEqual({ graded: 3, startable: 2, vsDrop: 2, beatDrop: 1, lostDrop: 1, pending: 1, noStats: 1 })
    expect(out.users.u1).toEqual({ p: [3, 2] })
  })

  it('a week-17 pickup is graded over weeks 17–18 (two weeks), not three', () => {
    const late = new Date(spans[17]!.lastKickoff.getTime() + DAY)
    const out = foldLedger({ season: 2026, cal, now: late, bench: [], adds: [add({ week: 17, recPts: 21, recWeeks: 2, hasDrop: false, altPts: null })], trades: noTrades })
    expect(out.pickups.startable).toBe(1)
  })
})

describe('ledgerRecordFor — a rate needs a sample', () => {
  const snapshot = (over: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
    season: 2026,
    throughWeek: 10,
    bench: { right: 2, wrong: 1, same: 0, gain: 9, pending: 0, unscored: 0, withdrawn: 0 },
    pickups: { graded: 2, startable: 1, vsDrop: 2, beatDrop: 1, lostDrop: 1, pending: 0, noStats: 0 },
    trades: noTrades,
    users: { u1: { b: [2, 1, 0], p: [2, 1] } },
    ...over,
  })

  it('small samples are counts with no percentage — yours and everyone’s', () => {
    const v = ledgerRecordFor(snapshot(), 'u1')!
    expect(v.bench).toEqual({ you: { right: 2, wrong: 1, same: 0, ratePct: null }, everyone: { right: 2, wrong: 1, same: 0, ratePct: null, gainPerCall: null } })
    expect(v.pickups?.you).toEqual({ graded: 2, startable: 1, ratePct: null })
    expect(v.trades).toBeNull()
  })

  it('earned rates appear: 5 decided for you, 30 for everyone, and the per-call gain with it', () => {
    const v = ledgerRecordFor(
      snapshot({
        bench: { right: 21, wrong: 9, same: 2, gain: 64, pending: 0, unscored: 0, withdrawn: 0 },
        users: { u1: { b: [4, 1, 0] } },
      }),
      'u1',
    )!
    expect(MIN_GRADED_FOR_OVERALL_RATE).toBe(30)
    expect(v.bench?.you?.ratePct).toBe(80)
    expect(v.bench?.everyone).toEqual({ right: 21, wrong: 9, same: 2, ratePct: 70, gainPerCall: 2 })
  })

  it('a trade letter shows only with enough graded deals', () => {
    const v = ledgerRecordFor(
      snapshot({
        trades: {
          byLetter: { A: { n: MIN_TRADES_PER_LETTER, netPerWeek: 4.14, ahead: 14, behind: 6 }, F: { n: MIN_TRADES_PER_LETTER - 1, netPerWeek: -3, ahead: 2, behind: 17 } },
          pending: 0,
          unscored: 0,
          read: 40,
          gradable: 39,
        },
      }),
      null,
    )!
    expect(v.trades).toEqual([{ letter: 'A', n: 20, netPerWeek: 4.1 }])
    expect(v.bench?.you).toBeNull()
  })

  it('nothing graded is null, and a malformed view never reaches the card', () => {
    expect(ledgerRecordFor(undefined, 'u1')).toBeNull()
    expect(
      ledgerRecordFor(snapshot({ bench: { right: 0, wrong: 0, same: 0, gain: 0, pending: 3, unscored: 0, withdrawn: 0 }, pickups: { graded: 0, startable: 0, vsDrop: 0, beatDrop: 0, lostDrop: 0, pending: 1, noStats: 0 }, users: {} }), 'u1'),
    ).toBeNull()
    const good = ledgerRecordFor(snapshot(), 'u1')
    expect(readLedgerRecordView(JSON.parse(JSON.stringify(good)))).toEqual(good)
    expect(readLedgerRecordView({ bench: { you: { right: 'x' } } })).toBeNull()
    expect(readLedgerRecordView({ trades: [{ letter: 'Z', n: 1, netPerWeek: 1 }] })).toBeNull()
  })
})
