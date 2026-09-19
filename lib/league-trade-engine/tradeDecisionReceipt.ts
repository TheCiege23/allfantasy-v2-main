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
}

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
  }
}
