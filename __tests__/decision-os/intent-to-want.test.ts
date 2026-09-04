import { describe, it, expect } from 'vitest'

import { deriveWantFromIntent } from '@/lib/decision-os/grounding/intentToWant'
import type { ChimmyOrchestrationIntent } from '@/lib/chimmy-orchestration/types'

const ALL_INTENTS: ChimmyOrchestrationIntent[] = [
  'trade', 'waiver', 'start_sit', 'player_value', 'draft', 'matchup', 'league_strength',
  'commissioner', 'bracket', 'injury', 'weather', 'manager_psychology', 'story_recap', 'general',
]

/**
 * ── The intent router — R2/R3.1/R3.3/R4b.5's opt-in slices were built, wired into the packet,
 * and never requested by the one live chat route. `deriveWantFromIntent` is the mapping that
 * closes that gap: given the intent the route already classifies a turn as (for an unrelated,
 * pre-existing purpose), decide which of the low-risk opt-in slices are worth asking for.
 *
 * PURE, so every intent's mapping is assertable directly — no route, no mocks, no request.
 */
describe('R2/R3.1/R3.3/R4b.5 intent router — deriveWantFromIntent', () => {
  it('start_sit turns on lineupDecision, and nothing else', () => {
    const w = deriveWantFromIntent('start_sit')
    expect(w.lineupDecision).toBe(true)
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.psychologyConsistency).toBe(false)
    expect(w.rosterValueGrade).toBe(false)
  })

  it('commissioner turns on commissionerHealthDecision, and nothing else', () => {
    const w = deriveWantFromIntent('commissioner')
    expect(w.commissionerHealthDecision).toBe(true)
    expect(w.lineupDecision).toBe(false)
    expect(w.psychologyConsistency).toBe(false)
    expect(w.rosterValueGrade).toBe(false)
  })

  it('manager_psychology turns on psychologyConsistency, and nothing else', () => {
    const w = deriveWantFromIntent('manager_psychology')
    expect(w.psychologyConsistency).toBe(true)
    expect(w.lineupDecision).toBe(false)
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.rosterValueGrade).toBe(false)
  })

  it('player_value turns on rosterValueGrade, and nothing else', () => {
    const w = deriveWantFromIntent('player_value')
    expect(w.rosterValueGrade).toBe(true)
    expect(w.lineupDecision).toBe(false)
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.psychologyConsistency).toBe(false)
  })

  /**
   * ⚠ THIS ASSERTION WAS INVERTED DELIBERATELY, AND THE REASON IS NOT "waiver works now".
   *
   * It still has no producer. But the slice now returns an honest `no_producer` gap that names
   * the missing input (the available-player pool) and points at the waiver surface that can
   * answer — so requesting it gives the model something to be honest ABOUT. Unmapped, a waiver
   * question got no waiver fact and no explanation, which is the silence D8 exists to prevent.
   */
  it('waiver turns on waiverDecision — which answers with an honest gap, not a decision', () => {
    const w = deriveWantFromIntent('waiver')
    expect(w.waiverDecision).toBe(true)
    expect(w.lineupDecision).toBe(false)
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.psychologyConsistency).toBe(false)
    expect(w.rosterValueGrade).toBe(false)
  })

  it('every other intent (trade, draft, matchup, league_strength, bracket, injury, weather, story_recap, general) turns on nothing', () => {
    const untouched: ChimmyOrchestrationIntent[] = [
      'trade', 'draft', 'matchup', 'league_strength', 'bracket', 'injury', 'weather', 'story_recap', 'general',
    ]
    for (const intent of untouched) {
      const w = deriveWantFromIntent(intent)
      expect(Object.values(w).every((v) => v === false)).toBe(true)
    }
  })

  it('every intent produces exactly one true flag or none — never two at once', () => {
    // A structural guard: if a future edit ever OR's two conditions together by mistake, this
    // catches it even though no single existing test would.
    for (const intent of ALL_INTENTS) {
      const w = deriveWantFromIntent(intent)
      const trueCount = Object.values(w).filter(Boolean).length
      expect(trueCount).toBeLessThanOrEqual(1)
    }
  })
})
