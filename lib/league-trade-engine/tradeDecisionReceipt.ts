export type PublicTradeDecisionReceipt = {
  completeness: 'complete' | 'partial'
  policyVersion: string
  format: string
  capturedAt: string
  contextualGradeAllowed: boolean
  missingEvidence: string[]
  reason: string | null
  assetValuesVerified: boolean
  projectionsVerified: boolean
  outcomeVerified: boolean
  outcomeMetric: string | null
  beforePct: number | null
  afterPct: number | null
  deltaPct: number | null
  valueSource: string | null
  projectionSource: string | null
  participantOutcomes: Array<{ rosterId: string; beforePct: number; afterPct: number; deltaPct: number }>
  participantDecisions: Array<{
    rosterId: string
    grade: string | null
    action: string
    recommendation: string
    reason: string
    valueGiven: number | null
    valueReceived: number | null
    valueDelta: number | null
    lineupPointsDelta: number | null
    outcomeMetric: string | null
    outcomeDeltaPct: number | null
    coveragePct: number
  }>
}

type DecisionSnapshotRow = {
  completeness: string
  policyVersion: string
  format: string
  capturedAt: Date
  evidence: unknown
  readiness: unknown
  outcomeSimulation: unknown
  assetContext: unknown
  decisionResult: unknown
}

/**
 * The ONLY columns a `trade_decision_snapshots` reader may ask for: what `publicTradeDecisionReceipt`
 * reads, plus `tradeId` to key it by.
 *
 * 🛑 A READER WITHOUT A `select` ASKS FOR EVERY COLUMN THE CLIENT KNOWS. The client is generated from
 * the schema at build time; the database gets its columns when a migration is applied — a separate
 * step. In between, a select-less `findMany` asks for `surface`/`inputHash`/`evaluationReceipt`, fails
 * with P2022, and every reader here `.catch`es to "no receipts" — so trade cards silently lose their
 * frozen grades. Naming the columns keeps the read inside what every database version has.
 * `__tests__/decision-os/receipt-store.test.ts` fails if a column a migration adds is listed here, or
 * if any reader drops this select.
 */
export const PUBLIC_RECEIPT_SELECT = {
  tradeId: true,
  completeness: true,
  policyVersion: true,
  format: true,
  capturedAt: true,
  evidence: true,
  readiness: true,
  outcomeSimulation: true,
  assetContext: true,
  decisionResult: true,
} as const

/** Remove private roster/user context while preserving the facts a trade card must explain. */
export function publicTradeDecisionReceipt(row: DecisionSnapshotRow): PublicTradeDecisionReceipt {
  const evidence = row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
    ? row.evidence as Record<string, unknown> : {}
  const readiness = row.readiness && typeof row.readiness === 'object' && !Array.isArray(row.readiness)
    ? row.readiness as Record<string, unknown> : {}
  const simulation = row.outcomeSimulation && typeof row.outcomeSimulation === 'object' && !Array.isArray(row.outcomeSimulation)
    ? row.outcomeSimulation as Record<string, unknown> : {}
  const assetContext = row.assetContext && typeof row.assetContext === 'object' && !Array.isArray(row.assetContext)
    ? row.assetContext as Record<string, unknown> : {}
  const decisionResult = row.decisionResult && typeof row.decisionResult === 'object' && !Array.isArray(row.decisionResult)
    ? row.decisionResult as Record<string, unknown> : {}
  const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    completeness: row.completeness === 'complete' ? 'complete' : 'partial',
    policyVersion: row.policyVersion,
    format: row.format,
    capturedAt: row.capturedAt.toISOString(),
    contextualGradeAllowed: readiness.contextualGradeAllowed === true,
    missingEvidence: Array.isArray(readiness.missingRequired) ? readiness.missingRequired.map(String) : [],
    reason: typeof readiness.reason === 'string' ? readiness.reason : null,
    assetValuesVerified: evidence.as_of_asset_values === 'available',
    projectionsVerified: evidence.as_of_projections === 'available',
    outcomeVerified: simulation.verified === true,
    outcomeMetric: typeof simulation.metric === 'string' ? simulation.metric : null,
    beforePct: numberOrNull(simulation.beforePct),
    afterPct: numberOrNull(simulation.afterPct),
    deltaPct: numberOrNull(simulation.deltaPct),
    valueSource: typeof assetContext.valueSource === 'string' ? assetContext.valueSource : null,
    projectionSource: typeof assetContext.projectionSource === 'string' ? assetContext.projectionSource : null,
    participantOutcomes: Array.isArray(simulation.participants)
      ? simulation.participants.flatMap((row) => {
          if (!row || typeof row !== 'object' || Array.isArray(row)) return []
          const item = row as Record<string, unknown>
          const beforePct = numberOrNull(item.beforePct)
          const afterPct = numberOrNull(item.afterPct)
          const deltaPct = numberOrNull(item.deltaPct)
          return typeof item.rosterId === 'string' && beforePct != null && afterPct != null && deltaPct != null
            ? [{ rosterId: item.rosterId, beforePct, afterPct, deltaPct }]
            : []
        })
      : [],
    participantDecisions: Array.isArray(decisionResult.participants)
      ? decisionResult.participants.flatMap((row) => {
          if (!row || typeof row !== 'object' || Array.isArray(row)) return []
          const item = row as Record<string, unknown>
          if (typeof item.rosterId !== 'string' || typeof item.reason !== 'string') return []
          return [{
            rosterId: item.rosterId,
            grade: typeof item.grade === 'string' ? item.grade : null,
            action: typeof item.action === 'string' ? item.action : 'review',
            recommendation: typeof item.recommendation === 'string' ? item.recommendation : '',
            reason: item.reason,
            valueGiven: numberOrNull(item.valueGiven),
            valueReceived: numberOrNull(item.valueReceived),
            valueDelta: numberOrNull(item.valueDelta),
            lineupPointsDelta: numberOrNull(item.lineupPointsDelta),
            outcomeMetric: typeof item.outcomeMetric === 'string' ? item.outcomeMetric : null,
            outcomeDeltaPct: numberOrNull(item.outcomeDeltaPct),
            coveragePct: numberOrNull(item.coveragePct) ?? 0,
          }]
        })
      : [],
  }
}
