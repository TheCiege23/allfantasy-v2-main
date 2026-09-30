/**
 * The Trades board shows a trade the week it is made (Guap, 2026-09-30: it "should show all trades as
 * they come in"). Deadline-first ranking put Pirate League twinty — 8 weeks left — at row 11 of a
 * 10-row board, so its 4-for-2 made that morning was emailed and on the league's own Trades tab, but
 * never on /core Trades.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { byTradeUrgency, isFreshTrade } from '@/lib/core-app/tradesBoard'

const w = (over: Partial<Parameters<typeof byTradeUrgency>[0]> = {}) => ({
  weeksLeft: 6,
  deadlineWeek: 10,
  noDeadline: false,
  tradesOnFile: 5,
  ...over,
})

describe('isFreshTrade — this week or last, this season, by week not by clock', () => {
  it('a trade in the current week or the one before is fresh', () => {
    expect(isFreshTrade({ season: 2026, week: 4 }, 2026, 4)).toBe(true)
    // Sleeper files a Tuesday trade under the week just played.
    expect(isFreshTrade({ season: 2026, week: 3 }, 2026, 4)).toBe(true)
  })

  it('an older trade, another season, or no week context is not', () => {
    expect(isFreshTrade({ season: 2026, week: 2 }, 2026, 4)).toBe(false)
    expect(isFreshTrade({ season: 2025, week: 4 }, 2026, 4)).toBe(false)
    expect(isFreshTrade({ season: 2026, week: 4 }, 2026, null)).toBe(false)
    expect(isFreshTrade(null, 2026, 4)).toBe(false)
    expect(isFreshTrade({ season: 2026, week: null }, 2026, 4)).toBe(false)
  })
})

describe('byTradeUrgency — a fresh trade leads, newest first', () => {
  it('the Pirate League twinty case: 8 weeks left and traded today outranks 6 weeks left and traded in July', () => {
    const kbfl = w({ weeksLeft: 6, tradesOnFile: 27 })
    const pirate = w({ weeksLeft: 8, tradesOnFile: 12, freshTrade: true, latest: { at: '2026-09-30T13:21:19.363Z' } })
    expect([kbfl, pirate].sort(byTradeUrgency)[0]).toBe(pirate)
  })

  it('among fresh leagues, the newest trade first', () => {
    const older = w({ freshTrade: true, latest: { at: '2026-09-29T20:05:10.883Z' } })
    const newer = w({ freshTrade: true, latest: { at: '2026-09-30T13:21:19.363Z' } })
    expect([older, newer].sort(byTradeUrgency)[0]).toBe(newer)
  })

  it('a fresh trade leads even in a league that never closes its window', () => {
    const live = w({ weeksLeft: 1, tradesOnFile: 3 })
    const never = w({ weeksLeft: null, deadlineWeek: null, noDeadline: true, freshTrade: true, latest: { at: '2026-09-30T00:00:00Z' } })
    expect([live, never].sort(byTradeUrgency)[0]).toBe(never)
  })

  it('without a fresh trade the deadline rule is unchanged — a board cached before this reads the same', () => {
    const soon = w({ weeksLeft: 2 })
    const later = w({ weeksLeft: 9 })
    expect([later, soon].sort(byTradeUrgency)[0]).toBe(soon)
    const passed = w({ weeksLeft: null, deadlineWeek: 4, tradesOnFile: 99 })
    expect([passed, later].sort(byTradeUrgency)[0]).toBe(later)
  })
})
