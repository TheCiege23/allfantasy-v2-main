/**
 * T5 — AllFantasy market aggregates. Pure, deterministic, READ-ONLY summaries over the T3 trade-market
 * event ledger. No external calls, no AI, and — critically — NO player value changes. Aggregates are
 * deduped per proposal; below a minimum sample the result is marked `insufficient` (raw counts still
 * returned) so no market claim is made.
 */

const MARKET_MIN_SAMPLE = 3

export interface MarketEventInput {
  eventType: string
  tradeProposalId: string
  grade: string | null
  fairnessScore: number | null
  confidenceScore: number | null
  payload: unknown
  createdAt: string | Date
}

interface MarketSummary {
  sampleSize: number
  acceptedCount: number
  rejectedCount: number
  canceledCount: number
  vetoedCount: number
  expiredCount: number
  processedCount: number
  averageFairness: number | null
  medianFairness: number | null
  averageConfidence: number | null
  averageValueDelta: number | null
  lastEventAt: string | null
}

interface AssetActivity {
  playerDemandCounts: Record<string, number>
  playerAcceptedCounts: Record<string, number>
  playerVetoedCounts: Record<string, number>
  playerRejectedCounts: Record<string, number>
  draftPickInclusionCount: number
  faabInclusionCount: number
  averageFaabAmount: number | null
  totalFaabMoved: number
}

interface GradeDistribution {
  aRange: number
  bRange: number
  cRange: number
  dfRange: number
  unknown: number
}

interface ReviewDistribution {
  lopsidedCount: number
  lowConfidenceCount: number
  highValueDeltaCount: number
  /** T4 does not persist reviewRecommended in the ledger (see docs) → deferred. */
  reviewRecommendedCount: number | null
}

interface MarketAggregates {
  sampleStatus: 'ok' | 'insufficient' | 'empty'
  summary: MarketSummary
  assetActivity: AssetActivity
  gradeDistribution: GradeDistribution
  reviewDistribution: ReviewDistribution
}

const TERMINAL_PRIORITY: Array<[string[], 'accepted' | 'rejected' | 'canceled' | 'vetoed' | 'expired']> = [
  [['proposal_accepted', 'commissioner_approved', 'trade_processed'], 'accepted'],
  [['commissioner_vetoed', 'proposal_vetoed'], 'vetoed'],
  [['proposal_rejected'], 'rejected'],
  [['proposal_canceled'], 'canceled'],
  [['proposal_expired'], 'expired'],
]

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}
function average(nums: number[]): number | null {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null
}
function gradeBucket(grade: string | null, dist: GradeDistribution) {
  if (!grade) return void (dist.unknown += 1)
  const g = grade[0]?.toUpperCase()
  if (g === 'A') dist.aRange += 1
  else if (g === 'B') dist.bRange += 1
  else if (g === 'C') dist.cRange += 1
  else if (g === 'D' || g === 'F') dist.dfRange += 1
  else dist.unknown += 1
}

type CreatedPayload = {
  assets?: { playerAssetIds?: string[]; pickAssets?: unknown[]; faabAmount?: number }
  snapshot?: { valueDifference?: number } | null
}

export function computeMarketAggregates(events: MarketEventInput[]): MarketAggregates {
  // Group by proposal; track its created event + the set of event types seen.
  const byProposal = new Map<string, { created?: MarketEventInput; types: Set<string>; lastAt: number }>()
  let lastEventAt = 0
  for (const e of events) {
    const t = new Date(e.createdAt).getTime()
    if (t > lastEventAt) lastEventAt = t
    let row = byProposal.get(e.tradeProposalId)
    if (!row) {
      row = { types: new Set(), lastAt: 0 }
      byProposal.set(e.tradeProposalId, row)
    }
    row.types.add(e.eventType)
    if (t > row.lastAt) row.lastAt = t
    if (e.eventType === 'proposal_created' && !row.created) row.created = e
  }

  const summary: MarketSummary = {
    sampleSize: 0, acceptedCount: 0, rejectedCount: 0, canceledCount: 0, vetoedCount: 0,
    expiredCount: 0, processedCount: 0, averageFairness: null, medianFairness: null,
    averageConfidence: null, averageValueDelta: null, lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null,
  }
  const assetActivity: AssetActivity = {
    playerDemandCounts: {}, playerAcceptedCounts: {}, playerVetoedCounts: {}, playerRejectedCounts: {},
    draftPickInclusionCount: 0, faabInclusionCount: 0, averageFaabAmount: null, totalFaabMoved: 0,
  }
  const gradeDistribution: GradeDistribution = { aRange: 0, bRange: 0, cRange: 0, dfRange: 0, unknown: 0 }
  const reviewDistribution: ReviewDistribution = { lopsidedCount: 0, lowConfidenceCount: 0, highValueDeltaCount: 0, reviewRecommendedCount: null }

  const fairnessVals: number[] = []
  const confidenceVals: number[] = []
  const valueDeltaVals: number[] = []
  const faabAmounts: number[] = []

  for (const [, row] of byProposal) {
    // Terminal outcome (dedupe per proposal).
    let terminal: string | null = null
    for (const [types, label] of TERMINAL_PRIORITY) {
      if (types.some((tt) => row.types.has(tt))) { terminal = label; break }
    }
    if (terminal === 'accepted') summary.acceptedCount += 1
    else if (terminal === 'vetoed') summary.vetoedCount += 1
    else if (terminal === 'rejected') summary.rejectedCount += 1
    else if (terminal === 'canceled') summary.canceledCount += 1
    else if (terminal === 'expired') summary.expiredCount += 1
    if (row.types.has('trade_processed')) summary.processedCount += 1

    const created = row.created
    if (!created) continue
    summary.sampleSize += 1

    if (typeof created.fairnessScore === 'number') {
      fairnessVals.push(created.fairnessScore)
      if (created.fairnessScore < 60) reviewDistribution.lopsidedCount += 1
      if (created.fairnessScore < 70) reviewDistribution.highValueDeltaCount += 1
    }
    if (typeof created.confidenceScore === 'number') {
      confidenceVals.push(created.confidenceScore)
      if (created.confidenceScore < 60) reviewDistribution.lowConfidenceCount += 1
    }
    gradeBucket(created.grade, gradeDistribution)

    const p = (created.payload ?? {}) as CreatedPayload
    const vd = p.snapshot?.valueDifference
    if (typeof vd === 'number') valueDeltaVals.push(Math.abs(vd))

    const playerIds = p.assets?.playerAssetIds ?? []
    for (const pid of playerIds) {
      assetActivity.playerDemandCounts[pid] = (assetActivity.playerDemandCounts[pid] ?? 0) + 1
      if (terminal === 'accepted') assetActivity.playerAcceptedCounts[pid] = (assetActivity.playerAcceptedCounts[pid] ?? 0) + 1
      if (terminal === 'vetoed') assetActivity.playerVetoedCounts[pid] = (assetActivity.playerVetoedCounts[pid] ?? 0) + 1
      if (terminal === 'rejected') assetActivity.playerRejectedCounts[pid] = (assetActivity.playerRejectedCounts[pid] ?? 0) + 1
    }
    if ((p.assets?.pickAssets?.length ?? 0) > 0) assetActivity.draftPickInclusionCount += 1
    const faab = p.assets?.faabAmount ?? 0
    if (faab > 0) {
      assetActivity.faabInclusionCount += 1
      faabAmounts.push(faab)
      if (terminal === 'accepted') assetActivity.totalFaabMoved += faab
    }
  }

  summary.averageFairness = average(fairnessVals)
  summary.medianFairness = median(fairnessVals)
  summary.averageConfidence = average(confidenceVals)
  summary.averageValueDelta = average(valueDeltaVals)
  assetActivity.averageFaabAmount = average(faabAmounts)

  const sampleStatus: MarketAggregates['sampleStatus'] =
    summary.sampleSize === 0 ? 'empty' : summary.sampleSize < MARKET_MIN_SAMPLE ? 'insufficient' : 'ok'

  return { sampleStatus, summary, assetActivity, gradeDistribution, reviewDistribution }
}
