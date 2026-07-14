/**
 * Real, independently-computed calls into the two genuinely distinct legacy
 * trade-grading algorithms found during this phase's audit — never
 * reimplemented, never approximated math, only adapted input shapes where a
 * grader needs data the provider-neutral context doesn't carry (disclosed
 * inline, never silently masked).
 *
 * Audit finding, worth restating here: what looked like "5-6 competing trade
 * systems" collapses to exactly TWO independently-computed scoring engines
 * once traced to their real call chains:
 *   - T2 (lib/trade-value/grader.ts's gradeTrade, via snapshot.ts) — wired to
 *     native redraft trade proposals (app/api/redraft/trade-proposals).
 *   - trade-engine.ts's computeTradeDrivers — wired to the trade-evaluator,
 *     trade-finder, and legacy goal-proposals/league-analyze routes.
 * Trade Finder's client-side `computeTradeGrade` is a display-only letter-
 * grade formatter over already-computed numbers, not an independent scorer.
 * Decision OS's own trade slice (lib/decision-os/trade/decision.ts) wraps T2
 * directly — comparing against it would be redundant with the T2 comparison
 * below, not a third independent data point.
 */

import { gradeTrade } from '@/lib/trade-value/grader'
import type { AssetValueSnapshot, SideTotals } from '@/lib/trade-value/types'
import type { AssetValuation } from '@/lib/trade-engine/trade-decision-context'
import type { LegacyGraderResult } from './types'

function toAssetValueSnapshot(a: AssetValuation, fromRosterId: string, toRosterId: string): AssetValueSnapshot {
  return {
    kind: 'player',
    fromRosterId,
    toRosterId,
    playerName: a.name,
    position: a.position,
    team: a.team,
    sources: {
      // Not available from the provider-neutral context (see this file's docstring) —
      // left honestly null rather than fabricated, which correctly lowers T2's own
      // computeConfidence() for this comparison, exactly as it would for any real
      // trade missing projection data.
      projectionValue: null,
      rankingValue: null,
      adpValue: a.adp?.value ?? null,
      fantasyCalcValue: a.marketValue,
    },
    internalValue: a.marketValue,
  }
}

/**
 * Runs T2's real gradeTrade() against assets adapted from the provider-neutral
 * context (Phase 4). Never throws — a failure here must never affect the
 * shadow evaluation it's feeding divergence data into.
 */
export function runT2Grader(
  sideARosterId: string,
  sideBRosterId: string,
  sideAAssets: AssetValuation[],
  sideBAssets: AssetValuation[]
): LegacyGraderResult {
  try {
    const sideA: SideTotals = {
      rosterId: sideARosterId,
      total: sideAAssets.reduce((sum, a) => sum + a.marketValue, 0),
      assets: sideAAssets.map((a) => toAssetValueSnapshot(a, sideARosterId, sideBRosterId)),
    }
    const sideB: SideTotals = {
      rosterId: sideBRosterId,
      total: sideBAssets.reduce((sum, a) => sum + a.marketValue, 0),
      assets: sideBAssets.map((a) => toAssetValueSnapshot(a, sideBRosterId, sideARosterId)),
    }
    const { grade } = gradeTrade(sideA, sideB)
    return { graderId: 't2', fairnessScore: grade.fairnessScore, grade: grade.grade, error: null }
  } catch (err) {
    return {
      graderId: 't2',
      fairnessScore: null,
      grade: null,
      error: err instanceof Error ? err.message : 'T2 grader failed',
    }
  }
}

// Note: there is no separate "trade-engine grader" adapter here. Unlike T2,
// trade-engine.ts's computeTradeDrivers() needs no input-shape adaptation —
// Asset[]/ManagerProfile are already exactly what leagueContextToIntelligence()
// (Phase 4) produces — and its result IS this shadow service's own primary
// fairness/grade value (see ShadowEvaluationEngine.ts), not a comparison
// point. TradeShadowService.ts calls computeTradeDrivers() directly.
