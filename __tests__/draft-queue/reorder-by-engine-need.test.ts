import { describe, expect, it } from 'vitest'
import { reorderQueueByNeed } from '@/lib/draft-queue-engine'
import { computeNeeds } from '@/lib/draft-helper/RecommendationEngine'

/*
 * "Reorder my queue by need" uses the draft engine's need model (2026-11-14) instead of its own
 * weight table, so it cannot disagree with the draft room's recommendation about what the roster
 * needs. Pinned: the order follows `computeNeeds`, and league shape (superflex) moves it.
 */

const QUEUE = [
  { playerName: 'Wide One', position: 'WR', playerId: 'w1' },
  { playerName: 'Passer One', position: 'QB', playerId: 'q1' },
  { playerName: 'Kicker One', position: 'K', playerId: 'k1' },
]

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']

describe('reorderQueueByNeed — engine need', () => {
  it('orders by the same need scores the engine computes', () => {
    const roster = ['QB', 'WR']
    const result = reorderQueueByNeed({ queue: QUEUE, rosterPositions: roster, sport: 'NFL', rosterSlots: SLOTS })
    const needs = computeNeeds(roster.map((position) => ({ position })), SLOTS, false, [], 'NFL')
    const expected = [...QUEUE]
      .sort((a, b) => (needs[b.position] ?? 0) - (needs[a.position] ?? 0) || a.position.localeCompare(b.position))
      .map((e) => e.playerId)
    expect(result.reordered.map((e) => e.playerId)).toEqual(expected)
    expect(result.needByPosition).toMatchObject({ QB: needs.QB, WR: needs.WR, K: needs.K })
  })

  it('a superflex league raises the second QB above a one-QB league', () => {
    const roster = ['QB', 'RB', 'RB', 'WR']
    const sf = reorderQueueByNeed({ queue: QUEUE, rosterPositions: roster, sport: 'NFL', rosterSlots: [...SLOTS, 'SUPER_FLEX'], isSF: true })
    const oneQb = reorderQueueByNeed({ queue: QUEUE, rosterPositions: roster, sport: 'NFL', rosterSlots: SLOTS })
    expect(sf.needByPosition!.QB).toBeGreaterThan(oneQb.needByPosition!.QB!)
  })

  it('keeps every entry and drops unavailable ones', () => {
    const result = reorderQueueByNeed({
      queue: QUEUE,
      rosterPositions: [],
      sport: 'NFL',
      availableNames: new Set(['wide one', 'passer one']),
    })
    expect(result.reordered.map((e) => e.playerId).sort()).toEqual(['q1', 'w1'])
    expect(result.explanation).toContain('Removed 1')
  })
})
