/**
 * Decision OS — canonical grading for the af-legacy Trade Command Center
 * (Slice 14: convergence).
 *
 * Legacy's grade is currently an LLM output constrained by FantasyCalc. This
 * module produces the CANONICAL grade for the same trade using
 * `buildTradeValueSnapshot` → `gradeTrade` — the engine the Decision Registry
 * names as authoritative — fed from the real FantasyCalc values legacy already
 * loaded (via the market-value basis completed in slice 14) and the canonical
 * pick curve.
 *
 * Pure and synchronous: no I/O, no provider calls. The caller decides whether
 * to merely COMPARE this (shadow) or to PRESENT it (live behind
 * DECISION_OS_TRADE_LIVE_LEGACY).
 *
 * Direction convention — verified against `buildTradeValueSnapshot`:
 *   sideFor(rosterId) sums assets whose `fromRosterId === rosterId`, i.e. what
 *   that side SENDS. With proposer = Team A, `valueDifference` is
 *   (A sends) − (B sends), so POSITIVE means A gave more away → favors B.
 *   (The `TradeGrade.valueDifference` doc comment says the opposite; the code
 *   is the authority and is what every consumer here follows.)
 */
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from '@/lib/trade-value/snapshot'
import type { TradeValueContext, TradeValueSnapshot } from '@/lib/trade-value/types'

const TEAM_A = 'legacy:teamA'
const TEAM_B = 'legacy:teamB'

/** Legacy's asset shape (structurally typed so this module never imports legacy internals). */
export interface LegacyTradeAssetInput {
  type: 'player' | 'pick' | 'faab'
  player?: { name?: string | null; pos?: string | null; team?: string | null } | null
  pick?: { year?: number | null; round?: number | null } | null
  faab?: { amount?: number | null } | null
}

/** Legacy verdict vocabulary, reproduced exactly so the surface contract is unchanged. */
export type LegacyVerdict =
  | 'Fair'
  | 'Slightly favors A'
  | 'Slightly favors B'
  | 'Strongly favors A'
  | 'Strongly favors B'

export interface LegacyCanonicalGrade {
  snapshot: TradeValueSnapshot
  /** Canonical letter grade, or null when the engine had nothing to grade. */
  grade: string | null
  fairnessScore: number | null
  confidenceScore: number
  valueDifference: number
  /** Canonical verdict rendered in legacy's own vocabulary, or null if ungradeable. */
  verdict: LegacyVerdict | null
  insufficientData: boolean
}

function toEnriched(
  asset: LegacyTradeAssetInput,
  fromRosterId: string,
  toRosterId: string,
  marketValueFor: (name: string) => number | null,
): EnrichedTradeAsset | null {
  const base = { fromRosterId, toRosterId }
  if (asset.type === 'pick') {
    return {
      ...base,
      kind: 'draft_pick',
      pickSeason: asset.pick?.year ?? null,
      pickRound: asset.pick?.round ?? null,
      pickLabel:
        asset.pick?.year != null && asset.pick?.round != null
          ? `${asset.pick.year} Round ${asset.pick.round}`
          : null,
      sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null },
    }
  }
  if (asset.type === 'faab') {
    return {
      ...base,
      kind: 'faab',
      faabAmount: asset.faab?.amount ?? null,
      sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null },
    }
  }
  const name = (asset.player?.name ?? '').trim()
  if (!name) return null
  return {
    ...base,
    kind: 'player',
    playerName: name,
    position: asset.player?.pos ?? null,
    team: asset.player?.team ?? null,
    sources: {
      projectionValue: null,
      rankingValue: null,
      adpValue: null,
      // The real signal legacy has. Consumed via the market-value basis.
      fantasyCalcValue: marketValueFor(name),
    },
  }
}

/**
 * Thresholds are the grader's OWN bullet boundaries (>= 88 "within normal
 * market range", >= 65 "modestly more value", else "significantly uneven") —
 * reused, never re-invented, so the verdict and the grade can never disagree.
 */
export function fairnessToLegacyVerdict(fairnessScore: number, valueDifference: number): LegacyVerdict {
  if (fairnessScore >= 88) return 'Fair'
  // valueDifference > 0 ⇒ Team A sent more away ⇒ the trade favors Team B.
  const favored = valueDifference > 0 ? 'B' : 'A'
  return fairnessScore >= 65 ? (`Slightly favors ${favored}` as LegacyVerdict) : (`Strongly favors ${favored}` as LegacyVerdict)
}

export function buildLegacyCanonicalGrade(input: {
  /** What Team A RECEIVES (legacy's assetsA) — these flow FROM B. */
  assetsA: LegacyTradeAssetInput[]
  /** What Team B RECEIVES (legacy's assetsB) — these flow FROM A. */
  assetsB: LegacyTradeAssetInput[]
  /** Resolve a player's market value (FantasyCalc convention, 0–10000). */
  marketValueFor: (name: string) => number | null
  sport?: string | null
  format?: string | null
  scoring?: string | null
  currentSeason?: number | null
}): LegacyCanonicalGrade {
  const assets: EnrichedTradeAsset[] = [
    // A receives ⇒ sent by B.
    ...input.assetsA.map((a) => toEnriched(a, TEAM_B, TEAM_A, input.marketValueFor)),
    // B receives ⇒ sent by A.
    ...input.assetsB.map((a) => toEnriched(a, TEAM_A, TEAM_B, input.marketValueFor)),
  ].filter((a): a is EnrichedTradeAsset => a !== null)

  const context = {
    sport: input.sport ?? 'NFL',
    leagueType: input.format ?? 'dynasty',
    scoring: input.scoring ?? 'unknown',
    rosterFormat: 'unknown',
  } as TradeValueContext

  const snapshot = buildTradeValueSnapshot({
    proposerRosterId: TEAM_A,
    receiverRosterId: TEAM_B,
    assets,
    context,
    currentSeason: input.currentSeason ?? null,
  })

  const { grade, fairnessScore, confidenceScore, valueDifference, insufficientData } = snapshot.grade
  return {
    snapshot,
    grade,
    fairnessScore,
    confidenceScore,
    valueDifference,
    verdict:
      insufficientData || fairnessScore == null
        ? null
        : fairnessToLegacyVerdict(fairnessScore, valueDifference),
    insufficientData,
  }
}
