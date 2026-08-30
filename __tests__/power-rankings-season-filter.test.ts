/**
 * The power-rankings picker lists one season — the newest the reader actually has.
 *
 * Measured on a real account: 557 leagues reached this picker and all 557 rendered, at 7,335
 * DOM nodes. 68 were the current season.
 *
 * ⚠ THE OTHER 489 ARE NOT ALL DUPLICATES. Of 298 distinct names, 108 recur across seasons
 * (six "AFC Dreaming!" cards, 2021-2026) — collapsing those is the win. But 234 names exist
 * ONLY before 2026 and this filter hides them completely. A deliberate trade for a rankings
 * board, not a duplicate cleanup.
 *
 * ⚠ THE TESTS THAT MATTER MOST ARE THE ONES ABOUT NOT SHOWING AN EMPTY PICKER. Filtering on
 * `new Date().getFullYear()` would be the obvious implementation and would blank the page for
 * any reader whose newest league is last season — a silent, total loss of function that a
 * happy-path test would never catch.
 */
import { describe, expect, it } from 'vitest'

import { selectLatestSeasonLeagues } from '@/app/power-rankings/latestSeasonLeagues'

const L = (id: string, season: string) => ({ id, season })

describe('selectLatestSeasonLeagues', () => {
  it('keeps only the newest season and reports what it hid', () => {
    const res = selectLatestSeasonLeagues([
      L('a', '2026'),
      L('b', '2025'),
      L('c', '2026'),
      L('d', '2021'),
    ])
    expect(res.visibleLeagues.map((l) => l.id)).toEqual(['a', 'c'])
    expect(res.latestSeason).toBe('2026')
    expect(res.hiddenCount).toBe(2)
  })

  it('never returns an empty picker just because the calendar rolled over', () => {
    /*
     * ⚠ THE REGRESSION THIS EXISTS FOR. A reader whose newest league is 2025 must still see it.
     * A `getFullYear()` filter would return nothing here and the page would look broken.
     */
    const res = selectLatestSeasonLeagues([L('a', '2025'), L('b', '2024')])
    expect(res.visibleLeagues.map((l) => l.id)).toEqual(['a'])
    expect(res.latestSeason).toBe('2025')
  })

  it('reports hiddenCount 0 when every league is the same season', () => {
    const res = selectLatestSeasonLeagues([L('a', '2026'), L('b', '2026')])
    expect(res.visibleLeagues).toHaveLength(2)
    expect(res.hiddenCount).toBe(0)
  })

  it('shows everything when no league carries a readable season', () => {
    /*
     * Filtering on a field that would not parse would hide the reader's whole library on a data
     * quirk. Showing all of them is the safe direction.
     */
    const res = selectLatestSeasonLeagues([L('a', ''), L('b', 'unknown')])
    expect(res.visibleLeagues).toHaveLength(2)
    expect(res.latestSeason).toBeNull()
    expect(res.hiddenCount).toBe(0)
  })

  it('ignores unparseable seasons rather than letting them win the max', () => {
    const res = selectLatestSeasonLeagues([L('a', '2026'), L('b', 'not-a-year')])
    expect(res.latestSeason).toBe('2026')
    expect(res.visibleLeagues.map((l) => l.id)).toEqual(['a'])
    expect(res.hiddenCount).toBe(1)
  })

  it('handles an empty list without throwing', () => {
    const res = selectLatestSeasonLeagues([])
    expect(res.visibleLeagues).toEqual([])
    expect(res.latestSeason).toBeNull()
    expect(res.hiddenCount).toBe(0)
  })

  it('does not mutate the input', () => {
    const input = [L('a', '2026'), L('b', '2025')]
    const copy = structuredClone(input)
    selectLatestSeasonLeagues(input)
    expect(input).toEqual(copy)
  })

  it('reproduces the production shape: 68 kept, 489 hidden', () => {
    const leagues = [
      ...Array.from({ length: 68 }, (_, i) => L(`cur${i}`, '2026')),
      ...Array.from({ length: 489 }, (_, i) => L(`old${i}`, String(2020 + (i % 6))),),
    ]
    const res = selectLatestSeasonLeagues(leagues)
    expect(res.visibleLeagues).toHaveLength(68)
    expect(res.hiddenCount).toBe(489)
    expect(res.latestSeason).toBe('2026')
  })
})

describe('selectLatestSeasonLeagues — the recency window', () => {
  it('defaults to one season, so every existing caller is unchanged', () => {
    const res = selectLatestSeasonLeagues([L('a', '2026'), L('b', '2025')])
    expect(res.visibleLeagues.map((l) => l.id)).toEqual(['a'])
    expect(res.hiddenCount).toBe(1)
  })

  it('keeps the newest TWO seasons at a window of 2, which is what the picker passes', () => {
    const res = selectLatestSeasonLeagues(
      [L('a', '2026'), L('b', '2025'), L('c', '2024'), L('d', '2021')],
      2,
    )
    expect(res.visibleLeagues.map((l) => l.id)).toEqual(['a', 'b'])
    expect(res.hiddenCount).toBe(2)
    expect(res.latestSeason).toBe('2026')
  })

  it('reproduces the measured production split at window 2', () => {
    /*
     * After series collapse: 374 cards — 68 current, 9 previous, 297 older. The window keeps
     * 77 and states that 297 are not listed.
     */
    const rows = [
      ...Array.from({ length: 68 }, (_, i) => L(`cur${i}`, '2026')),
      ...Array.from({ length: 9 }, (_, i) => L(`prev${i}`, '2025')),
      ...Array.from({ length: 297 }, (_, i) => L(`old${i}`, String(2020 + (i % 5)))),
    ]
    const res = selectLatestSeasonLeagues(rows, 2)
    expect(res.visibleLeagues).toHaveLength(77)
    expect(res.hiddenCount).toBe(297)
  })

  it('clamps a nonsense window rather than blanking the picker', () => {
    for (const w of [0, -3]) {
      const res = selectLatestSeasonLeagues([L('a', '2026'), L('b', '2025')], w)
      expect(res.visibleLeagues.map((l) => l.id), `window ${w}`).toEqual(['a'])
    }
  })

  it('a window wider than the history keeps everything and hides nothing', () => {
    const res = selectLatestSeasonLeagues([L('a', '2026'), L('b', '2025')], 10)
    expect(res.visibleLeagues).toHaveLength(2)
    expect(res.hiddenCount).toBe(0)
  })

  it('still excludes rows with an unreadable season from the window', () => {
    const res = selectLatestSeasonLeagues([L('a', '2026'), L('b', '2025'), L('c', '')], 2)
    expect(res.visibleLeagues.map((l) => l.id)).toEqual(['a', 'b'])
  })
})
