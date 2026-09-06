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
import type { CanonicalMemoEnrichment } from '@/lib/decision-os/trade/canonicalMemo'

/** One side's assets in console vocabulary — players enriched by the console's own analysis. */
export interface ConsoleComparableAsset {
  kind: 'player' | 'pick' | 'faab'
  /**
   * The resolved player id, when the console had one.
   *
   * 🛑 THIS IS WHAT MAKES THE COMPARISON INDEPENDENT. Without it the canonical engine can only be
   * handed the console's own numbers, and its "agreement" is partly a statement about arithmetic
   * being deterministic. `runTradeConsoleAnalysis` already resolves it per line
   * (`playerId: row?.id ?? raw.playerId ?? null`); it was simply dropped at this boundary.
   *
   * ⚠ Absent is normal, not an error: picks have no player id, and a player typed by hand rather
   * than picked may not resolve. Those assets keep the console's value and are counted separately
   * so the resolution rate is visible rather than assumed.
   */
  playerId?: string | null
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
  /**
   * TRUE only when at least one player asset was priced from a value the CONSOLE DID NOT SUPPLY.
   *
   * 🛑 THE BUCKET IS THE CLAIM. This is what routes a comparison into its own flip-gate surface, so
   * it must mean "an independent value was actually applied" — not "an enrichment object was
   * passed". An enrichment that resolves nothing leaves this false, and the row stays in the
   * tautological bucket where it belongs. Promoting an empty resolve would silently mix two
   * strengths of evidence in one sample, which cannot be undone after the fact.
   */
  independentInputs: boolean
  /** Player assets on both sides. Picks and FAAB are not players and are never counted here. */
  playerAssets: number
  /** Of those, how many carried a resolvable id — the resolution rate, measured rather than assumed. */
  playerAssetsWithId: number
}

const SYNTHETIC_YOU = 'console:you'
const SYNTHETIC_OPP = 'console:opponent'

function toEnriched(
  asset: ConsoleComparableAsset,
  fromRosterId: string,
  toRosterId: string,
  enrichment?: CanonicalMemoEnrichment,
): EnrichedTradeAsset {
  const base = { fromRosterId, toRosterId }
  if (asset.kind === 'pick') {
    return {
      ...base,
      kind: 'draft_pick',
      pickSeason: asset.year ?? null,
      pickRound: asset.round ?? null,
      pickLabel: asset.year != null && asset.round != null ? `${asset.year} Round ${asset.round}` : null,
      sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null },
    }
  }
  if (asset.kind === 'faab') {
    return {
      ...base,
      kind: 'faab',
      faabAmount: asset.amount ?? null,
      sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null },
    }
  }
  /*
   * Independent values first, the console's own second.
   *
   * ⚠ THE ORDER IS THE POINT. `adpValue` and `idpValue` used to be hardcoded null and
   * `fantasyCalcValue` was passed only when the console had itself priced from fantasycalc — so
   * every input the canonical engine saw came from the console. Preferring the enrichment where it
   * resolved gives the two engines genuinely different inputs; falling back where it did not keeps
   * the previous behaviour rather than degrading an asset to unpriced.
   */
  const id = asset.playerId ?? null
  const adp = id ? enrichment?.adpByPlayerId?.[id] ?? null : null
  const idp = id ? enrichment?.idpValueByPlayerId?.[id] ?? null : null
  const market = id ? enrichment?.marketValueByPlayerId?.[id] ?? null : null
  const consoleMarket =
    (asset.pricedSource ?? '').toLowerCase() === 'fantasycalc' ? asset.marketValue ?? null : null
  return {
    ...base,
    kind: 'player',
    playerName: asset.name ?? null,
    position: asset.position ?? null,
    team: asset.team ?? null,
    sources: {
      projectionValue: asset.projection ?? null,
      rankingValue: null,
      adpValue: adp,
      fantasyCalcValue: market ?? consoleMarket,
      idpValue: idp,
    },
  }
}

/** Did this asset get a value the console did not supply? Used to decide the parity bucket. */
function hasIndependentValue(
  asset: ConsoleComparableAsset,
  enrichment: CanonicalMemoEnrichment | undefined,
): boolean {
  if (asset.kind !== 'player') return false
  const id = asset.playerId ?? null
  if (!id || !enrichment) return false
  return (
    enrichment.adpByPlayerId?.[id] != null ||
    enrichment.idpValueByPlayerId?.[id] != null ||
    enrichment.marketValueByPlayerId?.[id] != null
  )
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
  /**
   * Values resolved WITHOUT the console — ADP, IDP and market by player id.
   *
   * Optional so every existing caller is byte-identical: omit it and the canonical engine sees
   * exactly what it saw before. Supplying it is what makes the comparison independent, and the
   * result says whether anything actually resolved.
   */
  enrichment?: CanonicalMemoEnrichment
}): ConsoleShadowComparison {
  const assets: EnrichedTradeAsset[] = [
    ...input.give.map((a) => toEnriched(a, SYNTHETIC_YOU, SYNTHETIC_OPP, input.enrichment)),
    ...input.get.map((a) => toEnriched(a, SYNTHETIC_OPP, SYNTHETIC_YOU, input.enrichment)),
  ]

  /*
   * Measured here rather than at the route, because this is the only place that knows which assets
   * the engine actually saw. `playerAssetsWithId` is the resolution rate the build was gated on —
   * it could not be read from existing telemetry, so it is emitted from the first request instead
   * of being waited for.
   */
  const bothSides = [...input.give, ...input.get]
  const playerAssets = bothSides.filter((a) => a.kind === 'player').length
  const playerAssetsWithId = bothSides.filter((a) => a.kind === 'player' && a.playerId).length
  const independentInputs = bothSides.some((a) => hasIndependentValue(a, input.enrichment))

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
      /*
       * ⚠ REPORTED ON THE REFUSAL PATH TOO. A comparison the engine declined to grade is still a
       * comparison that was ATTEMPTED with independent inputs, and it still has a resolution rate.
       * Zeroing these here would make the telemetry read as "no ids resolved" exactly when the
       * engine could not price them — hiding the case most worth seeing.
       */
      independentInputs,
      playerAssets,
      playerAssetsWithId,
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

  /**
   * 🛑 SECOND HONESTY PASS: ZERO CONFIDENCE IS NOT AGREEMENT.
   *
   * The pass above catches an ungradeable trade. This catches the subtler case it lets through — a
   * trade that grades cleanly and confidently means nothing.
   *
   * Observed on the first real production observation, 2026-09-04: a 2027 1st for a 2027 1st scored
   * `insufficientData: false`, `fairnessScore: 100`, `grade: 'A+'` — so the pass above did not fire —
   * with `confidenceScore: 0`, because neither pick could be priced. Advantage resolved to 'even',
   * the console also said 'even', and it recorded `agreement: true`.
   *
   * That is two engines failing to price the same deal and agreeing on the silence. The console's own
   * UI said so out loud: "an even-looking score here means we have no signal, not that the trade is
   * fair." Counting it would mean the Phase 3 gate is satisfied FASTEST by exactly the deals nobody
   * can price — the opposite of what it exists to prove.
   *
   * Zero is the line rather than an invented floor: any positive confidence is some signal, which the
   * gate can weight for itself. The computed grade and fairness are KEPT, unlike the pass above,
   * because they were genuinely produced — only the agreement claim is withdrawn.
   */
  const agreement =
    snapshot.grade.confidenceScore <= 0
      ? null
      : input.consoleAdvantage === 'mixed'
        ? null
        : input.consoleAdvantage === advantage

  return {
    canonicalGrade: snapshot.grade.grade,
    canonicalFairnessScore: snapshot.grade.fairnessScore,
    canonicalConfidenceScore: snapshot.grade.confidenceScore,
    canonicalValueDifference: snapshot.grade.valueDifference,
    canonicalAdvantage: advantage,
    agreement,
    independentInputs,
    playerAssets,
    playerAssetsWithId,
  }
}
