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
  /**
   * ⚠ THE SECOND ASSERTION IN THIS FILE TO BE INVERTED DELIBERATELY, AND FOR THE OPPOSITE REASON
   * TO THE WAIVER ONE BELOW — that one was turned ON because its gap became honest; this one is
   * turned OFF because its slice cannot fit the budget it has to run inside.
   *
   * Measured 2026-09-07 against a real 13-roster Sleeper league, with the live chat route's own
   * arguments: start_sit built the packet in 37,256 ms warm (38,528 ms on a second warm run,
   * 56,729 ms cold) against a 3s route ceiling, while every other intent finished in 0.6–1.6s.
   *
   * 🛑 SO `false` IS NOT "WE DECIDED A LINEUP DECISION IS NOT WORTH IT". The ceiling is a
   * `Promise.race`, which abandons the result without cancelling the work — the slice was
   * discarded on every turn AND still paid for in full. Requesting it made start/sit strictly
   * worse than not requesting it. Restore this mapping when the bridge is fast enough to land
   * inside 3s, and not before; a green test here is not evidence that it is.
   */
  it('start_sit turns on NOTHING — lineupDecision costs 37s against a 3s ceiling', () => {
    const w = deriveWantFromIntent('start_sit')
    expect(w.lineupDecision).toBe(false)
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.psychologyConsistency).toBe(false)
    expect(w.rosterValueGrade).toBe(false)
    expect(w.waiverDecision).toBe(false)
  })

  /**
   * The structural guard that would catch a careless restore: no intent may ask for
   * `lineupDecision`, whatever else changes. Without this, re-adding `intent === 'start_sit'`
   * turns the test above red and reads like a stale assertion to be updated — which is exactly
   * how a 37s slice gets switched back on.
   */
  it('NO intent asks for lineupDecision, on any path', () => {
    for (const intent of ALL_INTENTS) {
      expect(deriveWantFromIntent(intent).lineupDecision).toBe(false)
    }
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

  /**
   * ⚠ THE THIRD INVERTED ASSERTION IN THIS FILE, AND THE WEAKEST OF THE THREE — WHICH IS EXACTLY
   * WHY IT SAYS SO. `waiver` was turned ON because its gap became honest. `lineupDecision` was
   * turned OFF because 37s against a 3s ceiling meant it was discarded on every single turn, so
   * removing it cost nothing. This one is ~4.6s: over the ceiling most of the time, not all of it.
   *
   * Profiled 2026-09-07 from the packet's own `meta.sources`, median of 3:
   *   player_value  total 4,593 ms   rosterValueGrade completes at 4,590 ms  <- the critical path
   *
   * It goes because the ceiling discards the WHOLE packet, not the slow slice: asking for this
   * gambles fifteen other feeds against one roster grade on whether the build lands under 3s.
   *
   * 🛑 A GREEN TEST HERE IS NOT EVIDENCE THE INTENT IS FAST. With this off, player_value inherits
   * the base packet's own cost -- `marketValues` serialised behind `leagueRules`, 2,995 ms median
   * and itself over the ceiling under load. Restore this mapping only after that read is fixed.
   */
  it('player_value turns on NOTHING — rosterValueGrade is the packet critical path', () => {
    const w = deriveWantFromIntent('player_value')
    expect(w.rosterValueGrade).toBe(false)
    expect(w.lineupDecision).toBe(false)
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.psychologyConsistency).toBe(false)
    expect(w.waiverDecision).toBe(false)
  })

  /**
   * The same structural guard the lineup slice has: no intent may ask for `rosterValueGrade` on
   * any path. Without it, re-adding `intent === 'player_value'` reddens only the test above, which
   * reads like a stale assertion to update rather than a budget being breached.
   */
  it('NO intent asks for rosterValueGrade, on any path', () => {
    for (const intent of ALL_INTENTS) {
      expect(deriveWantFromIntent(intent).rosterValueGrade).toBe(false)
    }
  })

  /**
   * 🛑 INVERTED TWICE, AND THE SECOND INVERSION IS NOT THE FIRST ONE UNDONE.
   *
   * It was turned ON when the slice had no producer, because an honest `no_producer` gap naming
   * the missing input gave the model something to be honest ABOUT — better than silence.
   *
   * It is now OFF because the producer LANDED and was measured: ~6.6 s median against a real
   * 12-team league, against the chat route's 3 s ceiling, with the slice as the critical path.
   * The ceiling is a `Promise.race` that abandons the result without cancelling the work, so
   * requesting it costs the user 3 s, costs the database the full 6 s, and delivers the same empty
   * section as not asking. `intentToWant.ts` carries the numbers.
   *
   * ⚠ SO THIS TEST NOW PINS "ALL FIVE OFF FOR A WAIVER TURN", which reads like a test asserting
   * nothing. It is not: it is the assertion that the most expensive slice in the packet is not
   * being requested by the highest-traffic path to it, and it goes red the moment somebody
   * restores the mapping without doing the performance work first.
   */
  it('waiver turns on NOTHING — the producer exists but is ~2x over the route ceiling', () => {
    const w = deriveWantFromIntent('waiver')
    expect(w.waiverDecision).toBe(false)
    expect(w.lineupDecision).toBe(false)
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.psychologyConsistency).toBe(false)
    expect(w.rosterValueGrade).toBe(false)
  })

  /**
   * The same structural guard `lineupDecision` and `rosterValueGrade` already carry, and it earns
   * its place here for a reason those two do not have: this slice WORKS. A restore of
   * `intent === 'waiver'` produces correct waiver advice in every test and every manual check —
   * the only thing wrong with it is that it takes ~6.6 s, which no assertion about CONTENT can
   * see. Without this, reddening one test reads like a stale expectation to update.
   */
  it('NO intent asks for waiverDecision, on any path', () => {
    for (const intent of ALL_INTENTS) {
      expect(deriveWantFromIntent(intent).waiverDecision).toBe(false)
    }
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
