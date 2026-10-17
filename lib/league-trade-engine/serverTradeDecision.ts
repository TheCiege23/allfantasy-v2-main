import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'
import { evaluateTrade, type EvaluateTradeDeps, type TradeEvaluationReceipt } from '@/lib/decision-os/trade/evaluateTrade'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import { createLeagueTradeGrader, gradeDeal, loadNativePlayerNames } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { gradeInputsFromNativeItems } from '@/lib/decision-os/trade/tradeGradeInputs'
import { resolveViewerLeagueRoster } from '@/lib/trade-intel/viewerLeagueRoster'

export type ServerTradeParticipantDecision = {
  rosterId: string
  grade: string | null
  action: string
  recommendation: string
  valueGiven: number | null
  valueReceived: number | null
  valueDelta: number | null
  fairnessScore: number | null
  confidenceScore: number
  coverageStatus: 'complete' | 'partial' | 'blocked'
  coveragePct: number
  lineupPointsBefore: number | null
  lineupPointsAfter: number | null
  lineupPointsDelta: number | null
  /** The one grade's label for this side ("Slightly favors you"). Absent on receipts before 2026-09-25. */
  gradeLabel?: string | null
  /** Why this side has no letter, when it has none. */
  gradeWithheld?: string | null
}

export type ServerTradeDecisionResult = {
  modelVersion: string
  capturedAt: string
  scope: 'market'
  evaluatorSupported: boolean
  reason: string | null
  participants: ServerTradeParticipantDecision[]
  /**
   * The engine's full receipt. NOT saved here: `tradeService` writes it into this trade's own
   * `trade_decision_snapshots` row, in the proposal's transaction — one receipt per trade, one table.
   */
  evaluationReceipt?: TradeEvaluationReceipt | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function tradeAssetSummary(asset: TradeAssetInput): TradeAssetSummary {
  const metadata = record(asset.metadata)
  const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    assetType: asset.itemType,
    itemReference: asset.itemReference ?? null,
    fromRosterId: asset.fromRosterId,
    toRosterId: asset.toRosterId,
    playerId: ['player', 'keeper', 'devy'].includes(asset.itemType.toLowerCase()) ? asset.itemReference ?? null : stringValue(metadata.playerId),
    playerName: stringValue(metadata.playerName ?? metadata.name),
    position: stringValue(metadata.position),
    team: stringValue(metadata.team),
    pickSeason: numberValue(metadata.pickSeason ?? metadata.season),
    pickRound: numberValue(metadata.pickRound ?? metadata.round),
    pickNumber: numberValue(metadata.pickNumber),
    pickOriginalRosterId: stringValue(metadata.originalRosterId),
    pickLabel: stringValue(metadata.pickLabel ?? metadata.label) ?? (asset.itemType.toLowerCase().includes('pick') ? asset.itemReference ?? null : null),
    faabAmount: asset.faabAmount ?? numberValue(metadata.faabAmount ?? metadata.amount),
  }
}

function nativeItems(assets: TradeAssetInput[]) {
  return assets.map((a) => ({ ...a, itemReference: a.itemReference ?? null, metadata: a.metadata ?? null }))
}

/**
 * THE grade for a proposal, from the PROPOSER's side — what the Trade Center told them when they sent
 * it (see `lib/decision-os/trade/tradeGrade.ts`). Roster need is priced only when the proposing user's
 * own roster in this league IS the proposing roster; a commissioner proposing for someone else gets
 * the league's chart and scoring without it.
 */
export async function proposalOneGrade(input: {
  leagueId: string
  proposerRosterId: string
  proposedByUserId?: string | null
  assets: TradeAssetInput[]
  /** Names the caller already loaded, so the same items are not queried twice. */
  nameForId?: (id: string) => string | null
}): Promise<TradeGradeView> {
  const items = nativeItems(input.assets)
  const [grader, nameForId, viewer] = await Promise.all([
    createLeagueTradeGrader({ leagueId: input.leagueId, userId: input.proposedByUserId ?? null }).catch(() => null),
    input.nameForId ? Promise.resolve(input.nameForId) : loadNativePlayerNames(items),
    input.proposedByUserId
      ? resolveViewerLeagueRoster(input.leagueId, input.proposedByUserId).catch(() => null)
      : Promise.resolve(null),
  ])
  return gradeDeal(grader, {
    give: gradeInputsFromNativeItems(items.filter((a) => a.fromRosterId === input.proposerRosterId), nameForId),
    get: gradeInputsFromNativeItems(items.filter((a) => a.toRosterId === input.proposerRosterId), nameForId),
    viewerSide: Boolean(viewer?.ok && viewer.roster.id === input.proposerRosterId),
  })
}

/**
 * Recompute a custom or suggested two-team package entirely on the server, through the one trade
 * engine (`evaluateTrade`). Multi-team market letters stay withheld until the canonical evaluator
 * supports more than two sides; their signed participant outcome evidence is still saved.
 */
export async function evaluateServerTradeDecision(input: {
  leagueId: string
  proposerRosterId: string
  receiverRosterId: string
  participantRosterIds: string[]
  assets: TradeAssetInput[]
  season: number | null
  capturedAt?: string
  /** The user sending the offer — lets the proposer's grade count their own roster need. */
  proposedByUserId?: string | null
  /** Injected in tests; defaults to `proposalOneGrade`. */
  gradeProposal?: typeof proposalOneGrade
  /** Injected in tests; defaults to the engine's own dependencies. */
  engineDeps?: Partial<EvaluateTradeDeps>
}): Promise<ServerTradeDecisionResult> {
  const capturedAt = input.capturedAt ?? new Date().toISOString()
  if (input.participantRosterIds.length !== 2) {
    return {
      modelVersion: 'canonical-trade-market-v1', capturedAt, scope: 'market', evaluatorSupported: false,
      reason: `Market letter withheld: the canonical evaluator does not yet support ${input.participantRosterIds.length}-team trades.`,
      participants: [],
    }
  }
  const items = nativeItems(input.assets)
  const nameForId = await loadNativePlayerNames(items).catch(() => (): string | null => null)
  /*
   * 🛑 THE LETTER ON A RECEIPT IS THE ONE GRADE (2026-09-25). It was `projectedLetterFor` over the
   * canonical engine's values with the gap divided by what was GIVEN — a third rule beside the
   * Trade Center's (divided by the larger side) and the canonical fairness letter — so the frozen
   * "Then" on a card disagreed with the letter the proposer had just been shown. The canonical
   * evaluation still runs, inside `evaluateTrade`: it owns the lineup effect, the confidence and the
   * Decision OS record.
   */
  const receipt = await evaluateTrade(
    {
      surface: 'proposal',
      leagueId: input.leagueId,
      userId: input.proposedByUserId ?? null,
      give: gradeInputsFromNativeItems(items.filter((a) => a.fromRosterId === input.proposerRosterId), nameForId),
      get: gradeInputsFromNativeItems(items.filter((a) => a.toRosterId === input.proposerRosterId), nameForId),
      // Only read by the engine's default grader; the proposal grade below decides need itself.
      viewerSide: false,
      canonical: {
        proposerRosterId: input.proposerRosterId,
        receiverRosterId: input.receiverRosterId,
        participantRosterIds: input.participantRosterIds,
        assets: input.assets.map(tradeAssetSummary),
        currentSeason: input.season,
        includeRosterImpact: true,
      },
      evaluatedAt: capturedAt,
      // Saved in the trade's own snapshot row, not as a second receipt.
      persist: false,
    },
    {
      ...input.engineDeps,
      grade: () =>
        (input.gradeProposal ?? proposalOneGrade)({
          leagueId: input.leagueId,
          proposerRosterId: input.proposerRosterId,
          proposedByUserId: input.proposedByUserId ?? null,
          assets: input.assets,
          nameForId,
        }).catch((): TradeGradeView => ({ graded: false, reason: 'The grade could not be computed when this offer was sent.', basis: null })),
    },
  )
  if (!receipt.canonical) {
    return {
      modelVersion: 'canonical-trade-market-v1', capturedAt, scope: 'market', evaluatorSupported: true,
      reason: receipt.canonicalError ?? 'Server trade evaluation unavailable.',
      participants: [],
      evaluationReceipt: receipt,
    }
  }
  return {
    modelVersion: receipt.canonical.participants[0]?.memoVersion ?? 'canonical-trade-market-v1',
    capturedAt,
    scope: 'market',
    evaluatorSupported: true,
    reason: null,
    evaluationReceipt: receipt,
    participants: receipt.canonical.participants.map((evaluation) => {
      const rosterId = evaluation.rosterId
      // The receiver's letter is the proposer's grade seen from the other side — the exact mirror.
      const g = rosterId === input.proposerRosterId ? receipt.grade : receipt.partnerGrade
      return {
        rosterId,
        grade: g.graded ? g.letter : null,
        action: g.graded ? g.action : evaluation.action,
        recommendation: g.graded ? g.recommendation : evaluation.recommendation,
        valueGiven: g.graded ? g.giveValue : null,
        valueReceived: g.graded ? g.getValue : null,
        valueDelta: g.graded ? g.getValue - g.giveValue : null,
        fairnessScore: evaluation.fairnessScore,
        confidenceScore: evaluation.confidenceScore,
        coverageStatus: g.graded ? ('complete' as const) : evaluation.coverageStatus === 'complete' ? ('partial' as const) : evaluation.coverageStatus,
        coveragePct: g.graded ? 100 : evaluation.coveragePct,
        gradeLabel: g.graded ? g.label : null,
        gradeWithheld: g.graded ? null : g.reason,
        lineupPointsBefore: evaluation.rosterImpact?.startingPointsBefore ?? null,
        lineupPointsAfter: evaluation.rosterImpact?.startingPointsAfter ?? null,
        lineupPointsDelta: evaluation.rosterImpact?.startingPointsDelta ?? null,
      }
    }),
  }
}
