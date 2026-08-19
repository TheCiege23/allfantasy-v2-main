/**
 * Decision OS Replay Framework Phase 8 — Acceptance Probability Audit.
 *
 * Proves, against the REAL, unmocked computeTradeDrivers() (no mocks — this
 * is a direct behavioral test of the trade-engine itself, not the replay
 * pipeline), the exact finding from Phases 6-7's real staging measurements:
 *
 *   1. Varying VORP data alone (Asset.vorpValue) changes vorpScore/verdict
 *      but does NOT change acceptProbability at all — because
 *      computeSmartAcceptProbability()'s `vorpDeltaThem` parameter is
 *      never read in its body (confirmed by direct source inspection,
 *      not inferred from behavior alone).
 *   2. Varying real lineup impact (via rosterCtx producing a genuinely
 *      non-zero deltaThem) DOES change acceptProbability — proving the
 *      lineup-delta channel into acceptProbability is real and functional;
 *      it just happened to compute to ~0 for the specific real trades
 *      sampled from staging in Phases 6-7 (bench-depth dynasty trades that
 *      don't change either side's actual best-possible lineup).
 *
 * See docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §11 (Phase 8) for the
 * full architectural note this test set backs.
 */
import { describe, it, expect } from 'vitest'
import { computeTradeDrivers } from '@/lib/trade-engine/trade-engine'
import type { Asset } from '@/lib/trade-engine/types'

const CALIBRATED_WEIGHTS = { b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 }

describe('acceptProbability vs verdict/vorpScore — VORP has no channel into acceptProbability', () => {
  it('identical trade, only vorpValue differs -> acceptProbability unchanged, vorpScore changes', () => {
    const give: Asset[] = [{ id: 'g1', type: 'PLAYER', value: 1000, marketValue: 1000, name: 'Give Player' }]
    const receiveNoVorp: Asset[] = [{ id: 'r1', type: 'PLAYER', value: 1000, marketValue: 1000, name: 'Receive Player', vorpValue: 0 }]
    const receiveHighVorp: Asset[] = [{ id: 'r1', type: 'PLAYER', value: 1000, marketValue: 1000, name: 'Receive Player', vorpValue: 80 }]

    const withoutVorp = computeTradeDrivers(give, receiveNoVorp, null, null, false, false, undefined, undefined, undefined, undefined, undefined, CALIBRATED_WEIGHTS)
    const withVorp = computeTradeDrivers(give, receiveHighVorp, null, null, false, false, undefined, undefined, undefined, undefined, undefined, CALIBRATED_WEIGHTS)

    // vorpScore/verdict are free to differ — VORP-derived signals genuinely
    // feed the fairness/verdict path (computeFairnessScore's `score`).
    expect(withVorp.vorpScore).not.toBe(withoutVorp.vorpScore)

    // acceptProbability must be byte-identical — this is the finding.
    expect(withVorp.acceptProbability).toBe(withoutVorp.acceptProbability)
  })

  it('vorpDelta.vorpDeltaThem is real and non-zero, yet acceptProbability does not move — direct proof the parameter is a dead input', () => {
    const give: Asset[] = [{ id: 'g1', type: 'PLAYER', value: 1000, marketValue: 1000, name: 'Give', vorpValue: 10 }]
    const receive: Asset[] = [{ id: 'r1', type: 'PLAYER', value: 1000, marketValue: 1000, name: 'Receive', vorpValue: 90 }]

    const result = computeTradeDrivers(give, receive, null, null, false, false, undefined, undefined, undefined, undefined, undefined, CALIBRATED_WEIGHTS)

    // A large, real, non-zero VORP delta exists on the result object...
    expect(Math.abs(result.vorpDelta.vorpDeltaThem)).toBeGreaterThan(0)

    // ...and yet acceptProbability is whatever the market/manager-tendency
    // terms alone produce, unaffected by that VORP delta's magnitude. This
    // is confirmed by test 1 above (varying vorpValue with everything else
    // fixed leaves acceptProbability unchanged); this test just documents
    // that a genuinely non-trivial vorpDeltaThem coexists with that
    // invariance, ruling out "the delta is always ~0 anyway" as an
    // alternative explanation for VORP's lack of effect.
    expect(result.acceptProbability).toBeGreaterThanOrEqual(0.02)
    expect(result.acceptProbability).toBeLessThanOrEqual(0.95)
  })
})

describe('acceptProbability vs lineup context — the lineup-delta channel is real and functional', () => {
  const rosterPositions = ['RB', 'RB', 'BN', 'BN']

  it('a trade that meaningfully improves the counterparty\'s best-possible lineup (non-zero deltaThem) shifts acceptProbability', () => {
    const give: Asset[] = [{ id: 'g1', type: 'PLAYER', value: 9000, marketValue: 9000, name: 'Elite RB', pos: 'RB' }]
    const receive: Asset[] = [{ id: 'r1', type: 'PLAYER', value: 500, marketValue: 500, name: 'Bench RB', pos: 'RB' }]

    // Counterparty's roster before the trade: two weak RBs (low PPG) --
    // receiving the elite RB genuinely raises their best-lineup PPG.
    const theirWeakRoster: Asset[] = [
      { id: 't1', type: 'PLAYER', value: 300, marketValue: 300, name: 'Weak RB 1', pos: 'RB' },
      { id: 't2', type: 'PLAYER', value: 300, marketValue: 300, name: 'Weak RB 2', pos: 'RB' },
    ]
    const yourRoster: Asset[] = [{ id: 'y1', type: 'PLAYER', value: 9000, marketValue: 9000, name: 'Elite RB', pos: 'RB' }]

    const withImprovement = computeTradeDrivers(
      give, receive, null, null, false, false,
      { yourRoster, theirRoster: theirWeakRoster, rosterPositions },
      undefined, undefined, undefined, undefined, CALIBRATED_WEIGHTS,
    )

    // Counterparty's roster before the trade: already has an elite RB at
    // every real starting slot -- receiving another bench RB doesn't
    // change their best-possible lineup at all (deltaThem should be ~0).
    const theirStackedRoster: Asset[] = [
      { id: 't1', type: 'PLAYER', value: 9500, marketValue: 9500, name: 'Already-Elite RB 1', pos: 'RB' },
      { id: 't2', type: 'PLAYER', value: 9500, marketValue: 9500, name: 'Already-Elite RB 2', pos: 'RB' },
    ]

    const withoutImprovement = computeTradeDrivers(
      give, receive, null, null, false, false,
      { yourRoster, theirRoster: theirStackedRoster, rosterPositions },
      undefined, undefined, undefined, undefined, CALIBRATED_WEIGHTS,
    )

    // The whole point: when receiving the asset genuinely raises the
    // counterparty's best lineup, deltaThem is non-zero...
    expect(withImprovement.lineupDelta?.deltaThem).not.toBe(0)
    // ...and when it doesn't (already stacked at that position), deltaThem
    // is exactly 0 -- reproducing the real pattern measured in staging.
    expect(withoutImprovement.lineupDelta?.deltaThem).toBe(0)

    // Because deltaThem differs, acceptProbability must differ too --
    // proving the lineup channel genuinely reaches acceptProbability,
    // unlike the VORP channel proven dead above.
    expect(withImprovement.acceptProbability).not.toBe(withoutImprovement.acceptProbability)
  })
})
