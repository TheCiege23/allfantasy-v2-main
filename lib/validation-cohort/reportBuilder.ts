/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort (report builder).
 *
 * Deterministic assembly of per-league results and the cohort aggregate. Counts, classifications, and
 * explicit findings only — NO invented quality scores (Step 6). Given identical inputs it produces
 * identical output (stable ordering), so reports are diffable across runs.
 */
import type {
  ValidationAccount,
  NormalizedLeagueFacts,
  ArchetypeTag,
  DecisionOutputProbe,
  AnomalyFinding,
  LeagueValidationResult,
  CohortAggregateReport,
} from './types'

export function buildLeagueResult(input: {
  facts: NormalizedLeagueFacts
  archetypes: ArchetypeTag[]
  probes: DecisionOutputProbe[]
  anomalies: AnomalyFinding[]
  warnings: string[]
  derivationFailed?: boolean
}): LeagueValidationResult {
  const { facts, archetypes, probes, anomalies, warnings, derivationFailed } = input

  const available = probes.filter((p) => p.reachability === 'available').map((p) => p.output)
  const empty = probes.filter((p) => p.reachability === 'empty').map((p) => p.output)
  const dbBackedOnly = probes.filter((p) => p.reachability === 'db-backed-only').map((p) => p.output)

  const validationStatus: LeagueValidationResult['validationStatus'] = derivationFailed
    ? 'failed'
    : anomalies.length > 0
      ? 'review'
      : 'pass'

  return {
    leagueReference: facts.leagueReference,
    provider: 'sleeper',
    season: facts.season,
    archetypes,
    availableDecisionOutputs: available.sort(),
    emptyDecisionOutputs: empty.sort(),
    dbBackedOnlyOutputs: dbBackedOnly.sort(),
    probes,
    warnings,
    anomalies: anomalies.map((a) => `${a.code}: ${a.detail}`),
    validationStatus,
  }
}

function tally(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of keys) out[k] = (out[k] ?? 0) + 1
  return out
}

export function buildAggregate(input: {
  accounts: ValidationAccount[]
  perLeague: LeagueValidationResult[]
  cohortAnomalies: AnomalyFinding[]
  errorsByStage: Record<string, number>
  generatedAt?: string
}): CohortAggregateReport {
  const { accounts, perLeague, cohortAnomalies, errorsByStage } = input

  const archetypeCoverage = tally(
    perLeague.flatMap((l) => l.archetypes.map((a) => `${a.dimension}:${a.value}`)),
  )
  const recommendationCategoryCoverage = tally(
    perLeague.flatMap((l) => l.availableDecisionOutputs),
  )
  const emptyStateFrequency = tally(perLeague.flatMap((l) => l.emptyDecisionOutputs))
  const dbBackedOnlyFrequency = tally(perLeague.flatMap((l) => l.dbBackedOnlyOutputs))
  const repeatedAnomalyPatterns = tally(
    [...perLeague.flatMap((l) => l.anomalies.map((a) => a.split(':')[0]!)), ...cohortAnomalies.map((a) => a.code)],
  )

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    accountsSupplied: accounts.length,
    accountsResolved: accounts.filter((a) => a.status === 'resolved').length,
    accountsUnresolved: accounts.filter((a) => a.status === 'unresolved').length,
    accountsAmbiguous: accounts.filter((a) => a.status === 'ambiguous').length,
    accountsFailed: accounts.filter((a) => a.status === 'failed').length,
    uniqueLeaguesImported: new Set(perLeague.map((l) => l.leagueReference)).size,
    archetypeCoverage,
    recommendationCategoryCoverage,
    emptyStateFrequency,
    dbBackedOnlyFrequency,
    errorsByStage,
    repeatedAnomalyPatterns,
    cohortAnomalies,
    perLeague,
  }
}

/** Concise human-readable summary of the aggregate (for the CLI's `.txt` output). */
export function renderHumanSummary(report: CohortAggregateReport): string {
  const lines: string[] = []
  lines.push('Decision OS Validation Cohort — summary')
  lines.push(`generated: ${report.generatedAt}`)
  lines.push('')
  lines.push(`accounts: supplied=${report.accountsSupplied} resolved=${report.accountsResolved} unresolved=${report.accountsUnresolved} ambiguous=${report.accountsAmbiguous} failed=${report.accountsFailed}`)
  lines.push(`unique leagues imported: ${report.uniqueLeaguesImported}`)
  lines.push('')
  lines.push('archetype coverage:')
  for (const [k, v] of Object.entries(report.archetypeCoverage).sort()) lines.push(`  ${k}: ${v}`)
  lines.push('')
  lines.push('DB-less available Decision OS outputs:')
  for (const [k, v] of Object.entries(report.recommendationCategoryCoverage).sort()) lines.push(`  ${k}: ${v}`)
  lines.push('')
  lines.push('DB-backed-only outputs (not exercised in this mode):')
  for (const [k, v] of Object.entries(report.dbBackedOnlyFrequency).sort()) lines.push(`  ${k}: ${v}`)
  lines.push('')
  lines.push('anomaly patterns (for root-cause review — NOT auto-fixed):')
  const anomalies = Object.entries(report.repeatedAnomalyPatterns).sort()
  if (anomalies.length === 0) lines.push('  none')
  else for (const [k, v] of anomalies) lines.push(`  ${k}: ${v}`)
  if (report.cohortAnomalies.length > 0) {
    lines.push('')
    lines.push('cohort anomaly detail (trace before any fix):')
    for (const a of report.cohortAnomalies) lines.push(`  [${a.code}] ${a.detail}`)
  }
  lines.push('')
  lines.push('errors by stage:')
  const errs = Object.entries(report.errorsByStage).sort()
  if (errs.length === 0) lines.push('  none')
  else for (const [k, v] of errs) lines.push(`  ${k}: ${v}`)
  return lines.join('\n')
}
