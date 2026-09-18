import { describe, expect, it } from 'vitest'

import {
  COALESCE_MS,
  FLASH_MS,
  activeFlashes,
  diffScores,
  mergeFlashes,
  type ScoreSnapshot,
} from '@/lib/live/scoreChanges'

/*
 * Which number moved, and for how long we say so.
 *
 * The expensive mistakes here are all FALSE POSITIVES. A missed highlight is a
 * score the reader finds a beat later. A WRONG highlight announces points nobody
 * scored, on the one screen whose entire premise is that a number just changed —
 * and there are two easy ways to produce one: diffing against nothing on first
 * paint, and reading the null-to-0 of a kickoff as a score.
 */

function game(id: string, home: number | null, away: number | null): ScoreSnapshot {
  return { gameId: id, home: { score: home }, away: { score: away } }
}

describe('diffScores', () => {
  it('reports nothing when there is no previous payload', () => {
    expect(diffScores(null, [game('g1', 7, 3)])).toEqual([])
  })

  it('reports a side that scored', () => {
    expect(diffScores([game('g1', 7, 3)], [game('g1', 14, 3)])).toEqual([
      { gameId: 'g1', home: { from: 7, to: 14 }, away: null },
    ])
  })

  it('reports both sides when both moved', () => {
    const changes = diffScores([game('g1', 7, 3)], [game('g1', 14, 10)])
    expect(changes[0]!.home).toEqual({ from: 7, to: 14 })
    expect(changes[0]!.away).toEqual({ from: 3, to: 10 })
  })

  it('reports nothing when nothing moved', () => {
    expect(diffScores([game('g1', 7, 3)], [game('g1', 7, 3)])).toEqual([])
  })

  it('does NOT report the null-to-zero of a kickoff', () => {
    expect(diffScores([game('g1', null, null)], [game('g1', 0, 0)])).toEqual([])
  })

  it('does report a first score straight from null', () => {
    expect(diffScores([game('g1', null, null)], [game('g1', 7, 0)])).toEqual([
      { gameId: 'g1', home: { from: null, to: 7 }, away: null },
    ])
  })

  it('reports a score going down', () => {
    const changes = diffScores([game('g1', 14, 3)], [game('g1', 7, 3)])
    expect(changes[0]!.home).toEqual({ from: 14, to: 7 })
  })

  it('does not report a number becoming null', () => {
    expect(diffScores([game('g1', 14, 3)], [game('g1', null, 3)])).toEqual([])
  })

  it('does not report a game that was not in the previous payload', () => {
    expect(diffScores([game('g1', 7, 3)], [game('g1', 7, 3), game('g2', 21, 0)])).toEqual([])
  })

  it('ignores a game that disappeared', () => {
    expect(diffScores([game('g1', 7, 3), game('g2', 0, 0)], [game('g1', 7, 3)])).toEqual([])
  })
})

describe('mergeFlashes', () => {
  const NOW = 1_000_000
  const change = (gameId: string) => ({ gameId, home: { from: 0, to: 7 }, away: null })

  it('lights a changed game for the flash window', () => {
    expect(mergeFlashes(new Map(), [change('g1')], NOW).get('g1')).toBe(NOW + FLASH_MS)
  })

  it('drops highlights that have already finished', () => {
    expect(mergeFlashes(new Map([['old', NOW - 1]]), [], NOW).has('old')).toBe(false)
  })

  it('keeps highlights that are still running', () => {
    expect(mergeFlashes(new Map([['g1', NOW + 500]]), [], NOW).get('g1')).toBe(NOW + 500)
  })

  it('gives near-simultaneous changes a single end time', () => {
    const first = mergeFlashes(new Map(), [change('g1')], NOW)
    const second = mergeFlashes(first, [change('g2')], NOW + 1_000)
    expect(second.get('g1')).toBe(second.get('g2'))
  })

  it('does NOT merge changes that are far apart', () => {
    const first = mergeFlashes(new Map(), [change('g1')], NOW)
    const later = NOW + COALESCE_MS + FLASH_MS + 1
    const second = mergeFlashes(first, [change('g2')], later)
    expect(second.has('g1')).toBe(false)
    expect(second.get('g2')).toBe(later + FLASH_MS)
  })

  it('extends an existing highlight rather than cutting it short', () => {
    const existing = new Map([['g1', NOW + FLASH_MS + 5_000]])
    expect(mergeFlashes(existing, [change('g1')], NOW).get('g1')).toBe(NOW + FLASH_MS + 5_000)
  })
})

describe('activeFlashes', () => {
  it('lists only what is still lit', () => {
    const set = activeFlashes(new Map([['a', 1_000], ['b', 499]]), 500)
    expect([...set]).toEqual(['a'])
  })
})
