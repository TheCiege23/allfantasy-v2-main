/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort (calibration / anomaly detection).
 *
 * Deterministic detectors over the DB-less-derived data. They SURFACE suspected weaknesses for human
 * root-cause analysis (Step 7) — they do not auto-tune anything (Step 8: no tuning without proven cause).
 * Each finding leaves `suspectedLayer` unset/`unknown` unless the signal is unambiguous, because the
 * classification (source-data vs adapter vs normalization vs Decision OS) requires tracing, not guessing.
 */
import type { NormalizedLeagueFacts, AnomalyFinding, LeagueValidationResult } from './types'
import { monitorLeagueHealth } from '@/lib/league-health/league-health-engine'

/** Provider names that must never appear in provider-neutral Decision OS output. */
const PROVIDER_TERMS = /\b(sleeper|espn|yahoo|fantrax|mfl|draftkings|fanduel|underdog)\b/i

/** Documented thresholds (transparent, testable — not learned). */
export const ANOMALY_THRESHOLDS = {
  /** Urgent alerts at/above this for one league reads as over-eager escalation worth review. */
  excessiveUrgentAlerts: 5,
  /** Active-manager ratio below this while status is excellent/healthy is implausible. */
  minActiveRatioForHealthy: 0.5,
  /** An intervention recommendation appearing in ≥ this share of unrelated leagues is suspect. */
  identicalRecShare: 0.6,
} as const

type Health = ReturnType<typeof monitorLeagueHealth>

/** Per-league detectors (DB-less). */
export function detectLeagueAnomalies(facts: NormalizedLeagueFacts, health: Health): AnomalyFinding[] {
  const findings: AnomalyFinding[] = []
  const ref = facts.leagueReference

  // Provider leakage — the normalized/derived output must be provider-neutral.
  const haystack = [
    health.summary,
    ...health.biggestStrengths,
    ...health.biggestProblems,
    ...health.urgentAlerts,
    ...health.interventionRecommendations,
  ].join(' | ')
  if (PROVIDER_TERMS.test(haystack)) {
    findings.push({
      code: 'provider-string-in-normalized-output',
      leagueReferences: [ref],
      detail: `a provider name leaked into Decision OS output: "${haystack.match(PROVIDER_TERMS)?.[0]}"`,
      suspectedLayer: 'normalization',
    })
  }

  // Excessive high-priority escalation for one league.
  if (health.urgentAlerts.length >= ANOMALY_THRESHOLDS.excessiveUrgentAlerts) {
    findings.push({
      code: 'excessive-high-priority',
      leagueReferences: [ref],
      detail: `${health.urgentAlerts.length} urgent alerts for a single league (≥${ANOMALY_THRESHOLDS.excessiveUrgentAlerts})`,
    })
  }

  // Implausible health: "healthy/excellent" while most managers are inactive.
  const activeRatio = facts.numTeams > 0 ? facts.activeManagers / facts.numTeams : 1
  if (
    (health.overallStatus === 'excellent' || health.overallStatus === 'healthy') &&
    activeRatio < ANOMALY_THRESHOLDS.minActiveRatioForHealthy
  ) {
    findings.push({
      code: 'implausible-health-classification',
      leagueReferences: [ref],
      detail: `status=${health.overallStatus} but active ratio=${activeRatio.toFixed(2)} (<${ANOMALY_THRESHOLDS.minActiveRatioForHealthy})`,
    })
  }

  return findings
}

/** Cross-league / cohort detectors. */
export function detectCohortAnomalies(
  results: { facts: NormalizedLeagueFacts; health: Health }[],
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = []
  if (results.length < 2) return findings

  // Identical intervention recommendation appearing across many unrelated leagues.
  const recToLeagues = new Map<string, Set<string>>()
  for (const { facts, health } of results) {
    for (const rec of health.interventionRecommendations) {
      const key = rec.trim().toLowerCase()
      if (!recToLeagues.has(key)) recToLeagues.set(key, new Set())
      recToLeagues.get(key)!.add(facts.leagueReference)
    }
  }
  const total = results.length
  for (const [rec, leagues] of recToLeagues) {
    if (leagues.size / total >= ANOMALY_THRESHOLDS.identicalRecShare && leagues.size >= 2) {
      findings.push({
        code: 'identical-recommendation-across-leagues',
        leagueReferences: [...leagues],
        detail: `"${rec}" appears in ${leagues.size}/${total} leagues (≥${ANOMALY_THRESHOLDS.identicalRecShare * 100}%) — possible generic/default recommendation`,
      })
    }
  }

  return findings
}

/** Which per-league outputs were empty in EVERY league (a cohort-level "always empty" signal). */
export function detectAlwaysEmptyOutputs(perLeague: LeagueValidationResult[]): AnomalyFinding[] {
  if (perLeague.length === 0) return []
  const allOutputs = new Set<string>()
  for (const r of perLeague) for (const o of [...r.availableDecisionOutputs, ...r.emptyDecisionOutputs]) allOutputs.add(o)

  const findings: AnomalyFinding[] = []
  for (const output of allOutputs) {
    const emptyEverywhere = perLeague.every((r) => r.emptyDecisionOutputs.includes(output))
    if (emptyEverywhere) {
      findings.push({
        code: 'always-empty-output',
        leagueReferences: perLeague.map((r) => r.leagueReference),
        detail: `output "${output}" was empty in all ${perLeague.length} leagues`,
      })
    }
  }
  return findings
}
