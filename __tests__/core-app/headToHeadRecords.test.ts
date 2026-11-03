// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { headToHeadRecords } from '@/lib/core-app/headToHeadRecords'

const r = (week: number, matchupId: number | null, rosterId: string, pointsFor: number) => ({ week, matchupId, rosterId, pointsFor })

describe('headToHeadRecords — results from paired scores only', () => {
  it('a win, a loss and a tie from two-row pairs', () => {
    const out = headToHeadRecords([r(1, 1, 'a', 100), r(1, 1, 'b', 90), r(2, 1, 'a', 80), r(2, 1, 'b', 80)])
    expect(out.get('a')).toEqual({ wins: 1, losses: 0, ties: 1 })
    expect(out.get('b')).toEqual({ wins: 0, losses: 1, ties: 1 })
  })

  it('a roster alone in its matchup, a null matchupId, or a three-row group has no result', () => {
    const out = headToHeadRecords([r(1, 7, 'solo', 120), r(1, null, 'x', 99), r(2, 3, 'p', 1), r(2, 3, 'q', 2), r(2, 3, 's', 3)])
    expect(out.size).toBe(0)
  })

  it('the same matchupId in different weeks is a different game', () => {
    const out = headToHeadRecords([r(1, 1, 'a', 10), r(2, 1, 'b', 20)])
    expect(out.size).toBe(0)
  })
})
