import { describe, expect, it } from 'vitest'
import { buildShow, describeEntry, HOLD_MS, INTRO_MS, isShowCurrent, PACE_MS, progress, readShow } from '@/lib/draft-day/draftShow'

const order = [
  { slot: 1, rosterId: 'r1', displayName: 'Ace' },
  { slot: 2, rosterId: 'r2', displayName: 'Bee' },
  { slot: 3, rosterId: 'r3', displayName: 'Cee' },
  { slot: 4, rosterId: 'r4', displayName: 'Dee' },
]
const swapped = [{ ...order[1], slot: 1 }, { ...order[0], slot: 2 }, order[2], order[3]]
const now = new Date('2026-08-01T18:00:00.000Z')
const base = { sessionId: 's1', pace: 'standard' as const, order, teamCount: 4, startedBy: 'u1', now }

describe('buildShow', () => {
  it('reveals from the last pick up to #1', () => {
    const r = buildShow({ ...base, kind: 'order' })
    expect(r.ok && r.show.entries.map((e) => e.slot)).toEqual([4, 3, 2, 1])
  })
  it('refuses an order that is not a full 1..n', () => {
    expect(buildShow({ ...base, kind: 'order', order: order.slice(0, 3) })).toEqual({ ok: false, reason: 'order_incomplete' })
    expect(buildShow({ ...base, kind: 'order', order: [...order.slice(0, 3), { slot: 4, rosterId: 'r1', displayName: 'dup' }] })).toEqual({ ok: false, reason: 'order_incomplete' })
  })
  it('lottery: needs a draw, and the draw must be the order the draft will use', () => {
    expect(buildShow({ ...base, kind: 'lottery', lottery: null })).toEqual({ ok: false, reason: 'no_lottery' })
    const stale = { slotOrder: swapped, lotteryDraws: [{ pickSlot: 1, rosterId: 'r2' }], oddsSnapshot: [] }
    expect(buildShow({ ...base, kind: 'lottery', lottery: stale })).toEqual({ ok: false, reason: 'lottery_stale' })
  })
  it('lottery: carries each team\'s odds and how far a drawn team moved from its odds rank', () => {
    const lottery = {
      slotOrder: order,
      lotteryDraws: [{ pickSlot: 1, rosterId: 'r1' }, { pickSlot: 2, rosterId: 'r2' }],
      oddsSnapshot: [
        { rosterId: 'r2', oddsPercent: 50 },
        { rosterId: 'r3', oddsPercent: 30 },
        { rosterId: 'r1', oddsPercent: 20 },
      ],
    }
    const r = buildShow({ ...base, kind: 'lottery', lottery })
    if (!r.ok) throw new Error(r.reason)
    const one = r.show.entries.find((e) => e.slot === 1)!
    expect(one).toMatchObject({ rosterId: 'r1', oddsPct: 20, preLotterySlot: 3 })
    expect(describeEntry(one, 'lottery')).toBe('Pick 1: Ace (jumped 2 from odds rank 3)')
    const two = r.show.entries.find((e) => e.slot === 2)!
    expect(describeEntry(two, 'lottery')).toBe('Pick 2: Bee (fell 1 from odds rank 1)')
    // A team placed by the fallback order has odds but no draw movement.
    expect(r.show.entries.find((e) => e.slot === 3)).toMatchObject({ oddsPct: 30, preLotterySlot: null })
  })
})

describe('progress — one timeline everyone reads from the server clock', () => {
  const r = buildShow({ ...base, kind: 'order' })
  if (!r.ok) throw new Error('setup')
  const show = r.show
  const at = (ms: number) => progress(show, now.getTime() + ms)
  const step = PACE_MS.standard
  it('counts down, then turns one card per step', () => {
    expect(at(0)).toMatchObject({ revealed: 0, introLeftMs: INTRO_MS })
    expect(at(INTRO_MS)).toMatchObject({ revealed: 1, introLeftMs: 0, complete: false })
    expect(at(INTRO_MS + step - 1).revealed).toBe(1)
    expect(at(INTRO_MS + step).revealed).toBe(2)
    expect(at(INTRO_MS + 3 * step)).toMatchObject({ revealed: 4, complete: true, over: false, nextInMs: null })
  })
  it('closes itself after the hold', () => {
    expect(at(INTRO_MS + 3 * step + HOLD_MS - 1).over).toBe(false)
    expect(at(INTRO_MS + 3 * step + HOLD_MS).over).toBe(true)
  })
  it('round-trips through storage and goes stale when the order changes', () => {
    const stored = readShow({ draft_day_show: JSON.parse(JSON.stringify(show)) })
    expect(stored).toEqual(show)
    expect(isShowCurrent(show, { id: 's1', slotOrder: order })).toBe(true)
    expect(isShowCurrent(show, { id: 's1', slotOrder: swapped })).toBe(false)
    expect(isShowCurrent(show, { id: 's2', slotOrder: order })).toBe(false)
    expect(readShow({ draft_day_show: { v: 2 } })).toBeNull()
  })
})
