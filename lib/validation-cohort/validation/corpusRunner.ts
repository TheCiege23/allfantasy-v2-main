/**
 * Fantasy OS Suite — Phase V8.3: Decision OS validation runner over the persisted corpus.
 *
 * REPORT-ONLY: it consumes an already-persisted corpus and never fetches provider data. It exercises the
 * Decision OS entry points that are genuinely runnable over the file corpus — the pure `monitorLeagueHealth`
 * (League/Commissioner health + interventions) and `deriveLeagueAttentionSignals` (attention signals from
 * that health) — plus the provider-neutral activity evidence. It does NOT run the composed, DB-backed
 * subsystems (mission control, manager command center, daily brief, full recommendation composition), whose
 * inputs are assembled by DB-backed resolvers the file corpus does not reconstruct — see the V8.3 doc.
 *
 * Deterministic: identical corpus ⇒ identical report (stable ordering, fixed `now`).
 */
import { monitorLeagueHealth } from '@/lib/league-health/league-health-engine'
import { deriveLeagueAttentionSignals } from '@/lib/decision-os/attentionSignals'
import { toLeagueHealthInput } from '../decisionOsProbe'
import { classifyArchetypes } from '../archetypeClassifier'
import type { PersistedLeagueEvidence } from '../persistence/evidenceStore'
import { fingerprint, type RecommendationRecord } from './provenance'

export type CorpusDataSource = 'fixture' | 'single-account-smoke' | 'multi-account-cohort'

export type CorpusValidationReport = {
  generatedAt: string
  dataSource: CorpusDataSource
  leaguesEvaluated: number
  recommendations: RecommendationRecord[]
  diversity: {
    total: number
    perLeague: number
    typeDistribution: Record<string, number>
    priorityDistribution: Record<string, number>
    severityDistribution: Record<string, number>
    repeatedRecommendationFrequency: Record<string, number>
    unavailableFrequency: number
  }
  byArchetype: Record<string, { leagues: number; recommendations: number }>
  overFiring: { message: string; leagues: number; share: number }[]
  underFiring: { candidate: string; note: string }[]
}

const OVER_FIRING_SHARE = 0.6

/** Deterministic `now` so attention-signal timestamps don't vary run-to-run (report is diffable). */
const FIXED_NOW = new Date('2025-01-01T00:00:00.000Z')

function observedFacts(ev: PersistedLeagueEvidence): string[] {
  const f = ev.facts!
  const facts = [
    `status-derived from numTeams=${f.numTeams}`,
    `activeManagers=${f.activeManagers}/${f.numTeams}`,
    `totalTrades=${f.totalTrades}`,
    `totalWaiverClaims=${f.totalWaiverClaims}`,
    `draftState=${f.draftState}`,
  ]
  if (ev.activity) facts.push(`churn=${ev.activity.rosterChurn}`, `faab=${ev.activity.completedFaabSpending ?? 'n/a'}`)
  return facts
}

function missingEvidence(ev: PersistedLeagueEvidence): string[] {
  const missing: string[] = []
  // League health draws on signals the public provider API never exposes — disclosed, never fabricated.
  missing.push('disputes', 'votes', 'chat', 'commissioner-actions')
  if (!ev.bundle) missing.push('matchups', 'standings', 'draft-picks')
  return missing
}

/** Run the corpus validation. Pure over the provided (already-listed) evidence. */
export function runCorpusValidation(
  leagues: PersistedLeagueEvidence[],
  dataSource: CorpusDataSource,
): CorpusValidationReport {
  const recommendations: RecommendationRecord[] = []
  const byArchetype: Record<string, { leagues: number; recommendations: number }> = {}
  let unavailable = 0

  const withFacts = leagues.filter((l) => !!l.facts)

  for (const ev of withFacts) {
    const input = toLeagueHealthInput(ev.facts!)
    const health = monitorLeagueHealth(input)
    const fp = fingerprint(input)
    const evCats = Object.keys(ev.evidence ?? {}).filter((k) => (ev.evidence as Record<string, boolean>)[k])
    const facts = observedFacts(ev)
    const missing = missingEvidence(ev)
    const before = recommendations.length

    // League-health interventions (real derivation).
    for (const message of health.interventionRecommendations) {
      recommendations.push({
        recommendationType: 'league-health-intervention',
        sourceSubsystem: 'league-health-engine',
        leagueReference: ev.leagueReference,
        season: ev.season,
        scope: 'league',
        priority: null,
        severity: health.overallStatus,
        availability: 'available',
        evidenceCategories: evCats.length ? evCats : ['facts'],
        observedFacts: facts,
        missingEvidence: missing,
        inputFingerprint: fp,
        message,
      })
    }

    // League attention signals (real derivation) — financial status + draft date are honestly unavailable
    // over the corpus, so those specific signals simply do not fire (not fabricated).
    const signals = deriveLeagueAttentionSignals({
      leagueId: ev.leagueReference,
      now: FIXED_NOW,
      overallStatus: health.overallStatus,
      leagueHealthScore: health.leagueHealthScore,
      recommendedActions: [
        ...health.urgentAlerts.map((message) => ({ priority: 'urgent' as const, message })),
        ...health.interventionRecommendations.map((message) => ({ priority: 'standard' as const, message })),
      ],
      financialStatus: 'UNKNOWN',
      draftDateUtc: null,
    })
    for (const s of signals) {
      recommendations.push({
        recommendationType: `attention-signal:${s.type}`,
        sourceSubsystem: 'league-attention-signals',
        leagueReference: ev.leagueReference,
        season: ev.season,
        scope: 'league',
        priority: null,
        severity: s.severity,
        availability: 'available',
        evidenceCategories: ['league-health'],
        observedFacts: [`title=${s.title}`],
        missingEvidence: ['financial-status', 'draft-date'],
        inputFingerprint: fp,
        message: s.title,
      })
    }

    if (health.overallStatus === 'excellent' && recommendations.length === before) unavailable++

    // Archetype segmentation.
    const added = recommendations.length - before
    for (const tag of classifyArchetypes(ev.facts!)) {
      const key = `${tag.dimension}:${tag.value}`
      byArchetype[key] ??= { leagues: 0, recommendations: 0 }
      byArchetype[key].leagues++
      byArchetype[key].recommendations += added
    }
  }

  // Diversity metrics.
  const typeDist: Record<string, number> = {}
  const prioDist: Record<string, number> = {}
  const sevDist: Record<string, number> = {}
  const repeated: Record<string, number> = {}
  for (const r of recommendations) {
    typeDist[r.recommendationType] = (typeDist[r.recommendationType] ?? 0) + 1
    prioDist[r.priority ?? 'none'] = (prioDist[r.priority ?? 'none'] ?? 0) + 1
    sevDist[r.severity ?? 'none'] = (sevDist[r.severity ?? 'none'] ?? 0) + 1
    repeated[r.message] = (repeated[r.message] ?? 0) + 1
  }

  // Over-firing: a message appearing in ≥ OVER_FIRING_SHARE of evaluated leagues.
  const messageLeagues = new Map<string, Set<string>>()
  for (const r of recommendations) {
    if (!messageLeagues.has(r.message)) messageLeagues.set(r.message, new Set())
    messageLeagues.get(r.message)!.add(r.leagueReference)
  }
  const total = withFacts.length || 1
  const overFiring = [...messageLeagues.entries()]
    .filter(([, ls]) => ls.size / total >= OVER_FIRING_SHARE && ls.size >= 2)
    .map(([message, ls]) => ({ message, leagues: ls.size, share: ls.size / total }))
    .sort((a, b) => b.leagues - a.leagues)

  // Under-firing candidates: recommendation TYPES the engine can emit but that never appeared.
  const emittedTypes = new Set(recommendations.map((r) => r.recommendationType))
  const underFiring = ['league-health-intervention', 'attention-signal:low_league_health']
    .filter((t) => !emittedTypes.has(t))
    .map((candidate) => ({ candidate, note: 'engine can emit this but it never fired over this corpus (verify with a counterfactual before treating as a defect)' }))

  return {
    generatedAt: new Date().toISOString(),
    dataSource,
    leaguesEvaluated: withFacts.length,
    recommendations,
    diversity: {
      total: recommendations.length,
      perLeague: withFacts.length ? recommendations.length / withFacts.length : 0,
      typeDistribution: typeDist,
      priorityDistribution: prioDist,
      severityDistribution: sevDist,
      repeatedRecommendationFrequency: repeated,
      unavailableFrequency: unavailable,
    },
    byArchetype,
    overFiring,
    underFiring,
  }
}
