/**
 * Decision OS — Trade Value Console shadow compare (Slice 10; Phase 2→3 of
 * AF_TRADE_UNIFICATION_BRIEF).
 *
 * Upgrades the console surface from structured-skip instrumentation to REAL
 * cross-engine parity: the same enriched assets the console just analyzed are
 * fed to the canonical deterministic value engine (`buildTradeValueSnapshot`
 * → `gradeTrade`, the engine every trade surface converges on), and the two
 * verdicts are compared. Pure and synchronous — no I/O, no world loading; a
 * league-less (global) console analysis is fully comparable because the value
 * engine grades assets, not rosters.
 *
 * This is what makes the ≥95%-parity Phase 3 flip gate REACHABLE for the
 * console: skips can never converge; comparisons can.
 */
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from '@/lib/trade-value/snapshot'
import type { TradeValueContext } from '@/lib/trade-value/types'

/** One side's assets in console vocabulary — players enriched by the console's own analysis. */
export interface ConsoleComparableAsset {
  kind: 'player' | 'pick' | 'faab'
  name?: string | null
  position?: string | null
  team?: string | null
  /** Console's effective projection for the player, when present. */
  projection?: number | null
  /** Console's market value + its source, when present. */
  marketValue?: number | null
  pricedSource?: string | null
  /** Picks. */
  year?: number | null
  round?: number | null
  /** FAAB. */
  amount?: number | null
}

export type ConsoleAdvantage = 'even' | 'you' | 'opponent'

export interface ConsoleShadowComparison {
  /** Null when the canonical engine refused to grade (no resolvable value). */
  canonicalGrade: string | null
  canonicalFairnessScore: number | null
  canonicalConfidenceScore: number
  /** giveTotal − getTotal in canonical internal value (positive = you sent more away). */
  canonicalValueDifference: number
  /** Null when the canonical engine refused to grade — no advantage to assert. */
  canonicalAdvantage: ConsoleAdvantage | null
  /** Null when the console said 'mixed' (multi-sport) — not comparable to a two-sided grade. */
  agreement: boolean | null
}

const SYNTHETIC_YOU = 'console:you'
const SYNTHETIC_OPP = 'console:opponent'

function toEnriched(asset: ConsoleComparableAsset, fromRosterId: string, toRosterId: string): EnrichedTradeAsset {
  const base = { fromRosterId, toRosterId }
  if (asset.kind === 'pick') {
    return {
      ...base,
      kind: 'draft_pick',
      pickSeason: asset.year ?? null,
      pickRound: asset.round ?? null,
      pickLabel: asset.year != null && asset.round != null ? `${asset.year} Round ${asset.round}` : null,
      sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null },
    }
  }
  if (asset.kind === 'faab') {
    return {
      ...base,
      kind: 'faab',
      faabAmount: asset.amount ?? null,
      sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null },
    }
  }
  return {
    ...base,
    kind: 'player',
    playerName: asset.name ?? null,
    position: asset.position ?? null,
    team: asset.team ?? null,
    sources: {
      projectionValue: asset.projection ?? null,
      rankingValue: null,
      adpValue: null,
      fantasyCalcValue:
        (asset.pricedSource ?? '').toLowerCase() === 'fantasycalc' ? asset.marketValue ?? null : null,
    },
  }
}

/**
 * Pure: canonical grade for the console's trade + agreement with the console's
 * own advantage call. Same even-trade boundary the canonical grader uses
 * (fairness ≥ 88 = "within normal market range").
 */
export function compareConsoleVerdictWithCanonicalGrade(input: {
  give: ConsoleComparableAsset[]
  get: ConsoleComparableAsset[]
  consoleAdvantage: 'even' | 'you' | 'opponent' | 'mixed'
  context: { sport: string; leagueType?: string | null; scoring?: string | null }
  currentSeason?: number | null
}): ConsoleShadowComparison {
  const assets: EnrichedTradeAsset[] = [
    ...input.give.map((a) => toEnriched(a, SYNTHETIC_YOU, SYNTHETIC_OPP)),
    ...input.get.map((a) => toEnriched(a, SYNTHETIC_OPP, SYNTHETIC_YOU)),
  ]

  const context: TradeValueContext = {
    sport: input.context.sport,
    leagueType: input.context.leagueType ?? 'unknown',
    scoring: input.context.scoring ?? 'unknown',
    rosterFormat: 'unknown',
  } as TradeValueContext

  const snapshot = buildTradeValueSnapshot({
    proposerRosterId: SYNTHETIC_YOU,
    receiverRosterId: SYNTHETIC_OPP,
    assets,
    context,
    currentSeason: input.currentSeason ?? null,
  })

  // Honesty pass: an ungradeable trade has no canonical advantage to compare —
  // reporting 'even' here would manufacture agreement out of missing data and
  // poison the Phase 3 parity gate.
  if (snapshot.grade.insufficientData || snapshot.grade.fairnessScore == null) {
    return {
      canonicalGrade: null,
      canonicalFairnessScore: null,
      canonicalConfidenceScore: snapshot.grade.confidenceScore,
      canonicalValueDifference: snapshot.grade.valueDifference,
      canonicalAdvantage: null,
      agreement: null,
    }
  }

  // valueDifference = you-sent − you-received. Positive → you gave more away
  // → the opponent gained. The grader's own ≥88 fairness boundary defines
  // "even" — reused, not reinvented.
  const advantage: ConsoleAdvantage =
    snapshot.grade.fairnessScore >= 88
      ? 'even'
      : snapshot.grade.valueDifference > 0
        ? 'opponent'
        : 'you'

  return {
    canonicalGrade: snapshot.grade.grade,
    canonicalFairnessScore: snapshot.grade.fairnessScore,
    canonicalConfidenceScore: snapshot.grade.confidenceScore,
    canonicalValueDifference: snapshot.grade.valueDifference,
    canonicalAdvantage: advantage,
    agreement: input.consoleAdvantage === 'mixed' ? null : input.consoleAdvantage === advantage,
  }
}
