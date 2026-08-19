/**
 * Decision OS — Decision Context Object for `commissioner.league.health` (Slice 4).
 *
 * READ-ONLY assembly. The DCO is the ONLY thing the Commissioner Health decision may consume — no
 * decision engine resolves league data directly. The deterministic verdict (the snapshot memo) is
 * provided to the decision via an injected `evaluate` dep; this DCO carries the commissioner-scoped
 * World + provenance. No prisma, no writes.
 *
 * This is an ASSESSMENT decision (commissioner scope), not a manager action — additive to the core
 * Decision Object contract, which is unchanged.
 */
import type { DecisionProvenance } from '@/lib/decision-os/core/decision'
import { resolveSportAdapter } from '@/lib/decision-os-core'
import type { CommissionerHealthWorld } from './world'

export interface CommissionerHealthDCO {
  decision_type: 'commissioner.league.health'
  decider_scope: 'commissioner'
  world: CommissionerHealthWorld
  /** The commissioner the assessment is for. */
  user: { userId: string }
  league: { leagueId: string; sport: string }
  confidence_inputs: { dataConfidence: CommissionerHealthWorld['dataConfidence']; source: CommissionerHealthWorld['source'] }
  provenance: DecisionProvenance
  /** 0–100. */
  data_completeness: number
  uncertainty: string[]
  simulation_available: boolean
}

export interface CommissionerHealthDCOInput {
  world: CommissionerHealthWorld
  userId: string
}

function completenessFor(source: CommissionerHealthWorld['source'], confidence: CommissionerHealthWorld['dataConfidence']): number {
  if (source === 'dashboard-fallback') return 50
  if (confidence === 'high') return 100
  if (confidence === 'medium') return 80
  return 60
}

/** Pure, read-only DCO assembly with honest provenance + completeness. */
export function buildCommissionerHealthDCO(input: CommissionerHealthDCOInput): CommissionerHealthDCO {
  const w = input.world
  const uncertainty: string[] = []
  if (w.uncertainty) uncertainty.push(w.uncertainty)
  // Sport-adapter-backed equivalent of the old `sport === 'NFL'` string check —
  // see SportAdapter.tracksProviderDataCoverage's doc comment for why NFL is
  // (honestly) the only sport this applies to today.
  if (!w.nflDataCoverageKnown && resolveSportAdapter(w.sport)?.tracksProviderDataCoverage) {
    uncertainty.push('NFL data coverage could not be verified.')
  }

  const weakest: DecisionProvenance =
    w.source === 'dashboard-fallback'
      ? { weakest_source: 'dashboard-fallback', weakest_trust: 'low' }
      : w.dataConfidence === 'high'
        ? { weakest_source: 'snapshot', weakest_trust: 'high' }
        : { weakest_source: 'snapshot', weakest_trust: 'medium' }

  return {
    decision_type: 'commissioner.league.health',
    decider_scope: 'commissioner',
    world: w,
    user: { userId: input.userId },
    league: { leagueId: w.leagueId, sport: w.sport },
    confidence_inputs: { dataConfidence: w.dataConfidence, source: w.source },
    provenance: weakest,
    data_completeness: completenessFor(w.source, w.dataConfidence),
    uncertainty,
    simulation_available: false, // Slice 4 placeholder
  }
}
