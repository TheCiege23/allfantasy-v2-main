import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { selectLeagueWindow } from '@/lib/decision-os/lineup/shadow'

const L = (n: number) => Array.from({ length: n }, (_, i) => `L${i}`)

describe('selectLeagueWindow — coverage over ticks, not the same league forever', () => {
  it('takes cap ids starting at the offset', () => {
    expect(selectLeagueWindow(L(5), 2, 0)).toEqual(['L0', 'L1'])
    expect(selectLeagueWindow(L(5), 2, 2)).toEqual(['L2', 'L3'])
  })

  it('WRAPS instead of returning empty past the end', () => {
    // A plain slice(offset, offset+cap) yields [] once offset passes the length, which for a
    // scheduled sweep means it silently stops doing any work and looks like "no leagues".
    expect(selectLeagueWindow(L(5), 2, 4)).toEqual(['L4', 'L0'])
    expect(selectLeagueWindow(L(5), 2, 5)).toEqual(['L0', 'L1'])
    expect(selectLeagueWindow(L(5), 2, 12)).toEqual(['L2', 'L3'])
  })

  it('covers the whole population as the offset advances', () => {
    const seen = new Set<string>()
    for (let t = 0; t < 63; t++) for (const id of selectLeagueWindow(L(63), 1, t)) seen.add(id)
    expect(seen.size).toBe(63)
  })

  it('returns everything when the list is not longer than the cap', () => {
    expect(selectLeagueWindow(L(2), 5, 3)).toEqual(['L0', 'L1'])
    expect(selectLeagueWindow([], 3, 7)).toEqual([])
  })

  it('normalises hostile offsets rather than throwing or holing', () => {
    expect(selectLeagueWindow(L(4), 2, -1)).toEqual(['L3', 'L0'])
    expect(selectLeagueWindow(L(4), 2, -9)).toEqual(['L3', 'L0'])
    expect(selectLeagueWindow(L(4), 2, 1.9)).toEqual(['L1', 'L2'])
    expect(selectLeagueWindow(L(4), 2, NaN)).toEqual(['L0', 'L1'])
  })

  it('never returns a hole or a duplicate within one window', () => {
    const out = selectLeagueWindow(L(4), 3, 3)
    expect(out).toEqual(['L3', 'L0', 'L1'])
    expect(out.every((x) => typeof x === 'string')).toBe(true)
    expect(new Set(out).size).toBe(out.length)
  })

  it('a cap of 0 or junk still takes one, never zero', () => {
    expect(selectLeagueWindow(L(3), 0, 0)).toEqual(['L0'])
    expect(selectLeagueWindow(L(3), NaN, 1)).toEqual(['L1'])
  })
})
