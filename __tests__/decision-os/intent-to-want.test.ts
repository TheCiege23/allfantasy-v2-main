import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

import { deriveWantFromIntent } from '@/lib/decision-os/grounding/intentToWant'
import type { ChimmyOrchestrationIntent } from '@/lib/chimmy-orchestration/types'

const ALL_INTENTS: ChimmyOrchestrationIntent[] = [
  'trade', 'waiver', 'start_sit', 'player_value', 'draft', 'matchup', 'league_strength',
  'commissioner', 'bracket', 'injury', 'weather', 'manager_psychology', 'story_recap', 'general',
]

/**
 * ── The intent router — R2/R3.1/R3.3's opt-in slices were built, wired into the packet,
 * and never requested by the one live chat route. `deriveWantFromIntent` is the mapping that
 * closes that gap: given the intent the route already classifies a turn as (for an unrelated,
 * pre-existing purpose), decide which of the low-risk opt-in slices are worth asking for.
 *
 * PURE, so every intent's mapping is assertable directly — no route, no mocks, no request.
 */
describe('R2/R3.3 intent router — deriveWantFromIntent', () => {
  /*
   * 🛑 `lineupDecision` AND `psychologyConsistency` ARE NOT ROUTER KEYS ANY MORE — the slices were
   * deleted from the packet on 2026-11-17. Both had been pinned to a hard `false` here: the lineup
   * slice cost 37s against the 3s chat ceiling (measured 2026-09-07) and duplicated My Team's
   * `optimizeLineup`; the psychology one had no renderer. An exact key set fails the moment either
   * is re-added, which a pair of `toBe(false)` assertions could not do.
   */
  it('the router decides exactly five slices', () => {
    for (const intent of ALL_INTENTS) {
      expect(Object.keys(deriveWantFromIntent(intent)).sort()).toEqual([
        'commissionerHealthDecision',
        'myTeamLineup',
        'pendingTrades',
        'rosterValueGrade',
        'waiverDecision',
      ])
    }
  })

  // 2026-11-20: a trade question carries the offers waiting on the asker, graded by the one trade engine.
  it('trade turns on pendingTrades, and only trade does', () => {
    expect(deriveWantFromIntent('trade').pendingTrades).toBe(true)
    for (const intent of ALL_INTENTS.filter((i) => i !== 'trade')) expect(deriveWantFromIntent(intent).pendingTrades).toBe(false)
  })

  /*
   * 2026-11-20: start_sit asks for My Team's best lineup — the one optimizer the screen runs, read the way the lineup
   * tool reads it (NOT the retired 37 s `lineupDecision` engine). Bounded by the packet's deadline like any read.
   */
  it('start_sit turns on myTeamLineup, and nothing else', () => {
    const w = deriveWantFromIntent('start_sit')
    expect(w.myTeamLineup).toBe(true)
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.rosterValueGrade).toBe(false)
    expect(w.waiverDecision).toBe(false)
    for (const intent of ALL_INTENTS.filter((i) => i !== 'start_sit')) expect(deriveWantFromIntent(intent).myTeamLineup).toBe(false)
  })

  it('commissioner turns on commissionerHealthDecision, and nothing else', () => {
    const w = deriveWantFromIntent('commissioner')
    expect(w.commissionerHealthDecision).toBe(true)
    expect(w.rosterValueGrade).toBe(false)
  })

  it('manager_psychology turns on nothing', () => {
    const w = deriveWantFromIntent('manager_psychology')
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.rosterValueGrade).toBe(false)
  })

  /**
   * ⚠ THE THIRD INVERTED ASSERTION IN THIS FILE, AND THE WEAKEST OF THE THREE — WHICH IS EXACTLY
   * WHY IT SAYS SO. `waiver` was turned ON because its gap became honest. The old `lineupDecision`
   * was turned OFF because 37s against a 3s ceiling meant it was discarded on every single turn, so
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
  /*
   * ✅ RESTORED 2026-11-16 (re-score item 8) — BECAUSE THE PACKET NO LONGER WAITS ON IT, NOT BECAUSE IT GOT FAST.
   * The packet reads `loadRosterValueGradeSliceCached`: a cached grade is served at once and a miss computes in the
   * background, so the 4.6 s above is off the critical path on every turn. The guard below keeps that true: the
   * packet may only reach the grade through the cache-only read.
   */
  it('player_value turns on rosterValueGrade, and nothing else', () => {
    const w = deriveWantFromIntent('player_value')
    expect(w.rosterValueGrade).toBe(true)
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.waiverDecision).toBe(false)
  })

  /**
   * The structural guard, moved to where the budget now lives: only player_value asks for the grade, and the
   * packet never calls the uncached compute — re-wiring the direct `loadRosterValueGradeSlice` would put 4.6 s back
   * on the critical path with every assertion above still green.
   */
  it('only player_value asks for rosterValueGrade, and the packet reads it cache-only', () => {
    for (const intent of ALL_INTENTS) {
      expect(deriveWantFromIntent(intent).rosterValueGrade).toBe(intent === 'player_value')
    }
    const packet = readFileSync(resolve(process.cwd(), 'lib/decision-os/grounding/packet.ts'), 'utf8')
    expect(packet).toMatch(/kick\('rosterValueGrade', loadRosterValueGradeSliceCached\(/)
    expect(packet).not.toMatch(/loadRosterValueGradeSlice\(/)
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
    expect(w.commissionerHealthDecision).toBe(false)
    expect(w.rosterValueGrade).toBe(false)
  })

  it('every other intent (draft, matchup, league_strength, bracket, injury, weather, story_recap, general) turns on nothing', () => {
    // `trade` left this list on 2026-11-20: it turns on `pendingTrades` (tested above).
    const untouched: ChimmyOrchestrationIntent[] = [
      'draft', 'matchup', 'league_strength', 'bracket', 'injury', 'weather', 'story_recap', 'general',
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
