import { callDecisionOS } from '../../adapter/transport'
import { isLiveReady } from '../../liveReadiness'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import { liveRecommendationsClient } from '../../recommendations/decision-os-client/live'
import type { CommissionerErrorContract } from '../../contracts'
import type { SeverityTier } from '../../tokens/colors'
import type { LeagueHealthClient, LeagueHealthDetail, LeagueHealthEvidencePoint, LeagueHealthRisk } from './types'

/**
 * League Health, wired.
 *
 * 🛑 THREE OF THESE FOUR METHODS WERE PERMANENT PLACEHOLDERS, AND THE REASON WAS REAL: the
 * contract asked for a baseline-minus-deductions scoring model, a persisted risk lifecycle, and
 * per-recommendation confidence, none of which the intelligence pipeline computes. Rather than
 * fabricate them, this module returned `upstream_unavailable` — which meant the League Health tab
 * showed a paying commissioner an error where their league's condition should be.
 *
 * The contract was the thing that was wrong. `types.ts` is now narrowed to what is genuinely
 * computed, and each method below is traceable to a field the API returns:
 *
 *   getHealthDetail   -> leagueEngagementScore, retentionRisk, commissionerWorkload,
 *                        participationDistribution, completeness
 *   getRisks          -> the same three condition signals, as severity-tiered findings with no
 *                        invented age or lifecycle status
 *   getEvidence       -> healthNarrative (unchanged; this one was already wired)
 *   getRecommendations-> delegated to Recommendations Center's own live client
 *
 * ⚠ `getRecommendations` DELEGATES RATHER THAN RE-MAPPING. Both modules read the same
 * `/api/v1/intelligence/league` payload, and Recommendations Center already owns the mapping —
 * including the decision to OMIT `confidence`/`expectedImpact`/`primaryActionLabel`/`status` rather
 * than default them. A second copy here would be two implementations of one rule, and would drift
 * the first time either changed. Composing another module's live client is the established pattern
 * (Activity Stream, Notification Center and Search all do it).
 */

/**
 * The league's own severity, banded from the score.
 *
 * Thresholds match Mission Control's `scoreToSeverityTier` deliberately: two surfaces disagreeing
 * about whether the same league is "elevated" is worse than either threshold being slightly wrong.
 */
function scoreToTier(score: number): SeverityTier {
  if (score >= 75) return 'positive'
  if (score >= 50) return 'standard'
  if (score >= 25) return 'elevated'
  return 'critical'
}

/**
 * Decision OS's four risk bands mapped onto the design system's severity tiers.
 *
 * ⚠ `medium` maps to `elevated`, not to `standard`. `standard` renders as "nothing to see here",
 * and a medium retention risk is a thing a commissioner should look at — the whole point of surfacing
 * it. There is no lossless mapping between a 4-band vendor vocabulary and a 5-tier design one, so
 * this errs toward showing a finding rather than muting it.
 */
const RISK_BAND_TO_TIER: Record<string, SeverityTier> = {
  low: 'positive',
  medium: 'elevated',
  high: 'elevated',
  critical: 'critical',
}

function bandToTier(band: string | null | undefined): SeverityTier {
  return RISK_BAND_TO_TIER[String(band ?? '').toLowerCase()] ?? 'standard'
}

const BAND_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

function bandLabel(band: string | null | undefined): string {
  return BAND_LABEL[String(band ?? '').toLowerCase()] ?? 'Unknown'
}

function notYetIntegrated(): CommissionerErrorContract {
  return {
    category: 'upstream_unavailable',
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'league-health',
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

interface LeagueIntelligenceNarrativeShape {
  data: {
    leagueEngagementScore: number
    retentionRisk: string
    commissionerWorkload: string
    participationDistribution: { activeManagers: number; totalManagers: number }
    completeness: number
    healthNarrative: { engagementSummary: string; topConcern: string | null; standoutSignal: string | null }
  }
}

function toEvidencePoints(narrative: LeagueIntelligenceNarrativeShape['data']['healthNarrative']): LeagueHealthEvidencePoint[] {
  const points: LeagueHealthEvidencePoint[] = [
    { label: 'Engagement Summary', detail: narrative.engagementSummary },
  ]
  if (narrative.topConcern) points.push({ label: 'Top Concern', detail: narrative.topConcern })
  if (narrative.standoutSignal) points.push({ label: 'Standout Signal', detail: narrative.standoutSignal })
  return points
}

/**
 * One `/league` read, shared by `getHealthDetail` and `getRisks` so the two can never disagree about
 * the same league in the same session.
 */
async function readLeagueIntelligence(): Promise<
  { ok: true; intel: LeagueIntelligenceNarrativeShape['data']; timestamp: string } | { ok: false; error: CommissionerErrorContract; timestamp: string }
> {
  const timestamp = new Date().toISOString()
  if (!(await isLiveReady('league-health'))) return { ok: false, error: notYetIntegrated(), timestamp }
  const leagueId = await resolveActiveLeagueId()
  if (!leagueId) return { ok: false, error: notYetIntegrated(), timestamp }

  const { data, error } = await callDecisionOS<LeagueIntelligenceNarrativeShape>(
    'league-health',
    `/api/v1/intelligence/league?leagueId=${encodeURIComponent(leagueId)}`,
  )
  if (error || !data) return { ok: false, error: error ?? notYetIntegrated(), timestamp }
  return { ok: true, intel: data.data, timestamp }
}

/**
 * The league's real conditions, as findings.
 *
 * Only conditions that ARE something get a row. A league with low retention risk and a light
 * commissioner load produces an empty list, and the view renders "no active risks" — which is the
 * true answer, not a gap. Padding it to look thorough is how a risk list stops being read.
 */
function toRisks(intel: LeagueIntelligenceNarrativeShape['data']): LeagueHealthRisk[] {
  const risks: LeagueHealthRisk[] = []
  const { activeManagers, totalManagers } = intel.participationDistribution

  const retentionTier = bandToTier(intel.retentionRisk)
  if (retentionTier === 'elevated' || retentionTier === 'critical') {
    risks.push({
      id: 'risk-retention',
      category: 'Retention',
      severity: retentionTier,
      description: `League-wide retention risk is ${bandLabel(intel.retentionRisk).toLowerCase()}.`,
    })
  }

  const workloadTier = bandToTier(intel.commissionerWorkload)
  if (workloadTier === 'elevated' || workloadTier === 'critical') {
    risks.push({
      id: 'risk-workload',
      category: 'Commissioner load',
      severity: workloadTier,
      description: `This league is asking ${bandLabel(intel.commissionerWorkload).toLowerCase()} attention of its commissioner right now.`,
    })
  }

  /*
   * ⚠ THE DENOMINATOR IS NAMED IN THE TEXT, NOT LEFT TO BE INFERRED. `totalManagers` counts managers
   * with an event inside the lookback window, not the league's roster count, so "2 of 5" would read
   * as a five-team league. Saying "of the 5 seen active recently" is the difference between a
   * finding and a misreading.
   */
  if (totalManagers > 0 && activeManagers < totalManagers) {
    const quiet = totalManagers - activeManagers
    risks.push({
      id: 'risk-participation',
      category: 'Participation',
      severity: activeManagers === 0 ? 'critical' : 'elevated',
      description: `${quiet} of the ${totalManagers} manager${totalManagers === 1 ? '' : 's'} seen in this window ${quiet === 1 ? 'is' : 'are'} no longer active in it.`,
    })
  }

  return risks
}

export const liveLeagueHealthClient: LeagueHealthClient = {
  async getHealthDetail() {
    const read = await readLeagueIntelligence()
    if (!read.ok) return { data: null, error: read.error, source: 'live', timestamp: read.timestamp }

    const score = Math.round(read.intel.leagueEngagementScore)
    const detail: LeagueHealthDetail = {
      score,
      tier: scoreToTier(score),
      retentionRisk: bandToTier(read.intel.retentionRisk),
      commissionerWorkload: bandToTier(read.intel.commissionerWorkload),
      participation: {
        activeManagers: read.intel.participationDistribution.activeManagers,
        totalManagers: read.intel.participationDistribution.totalManagers,
      },
      completeness: read.intel.completeness,
    }
    return { data: detail, error: null, source: 'live', timestamp: read.timestamp }
  },

  async getRisks() {
    const read = await readLeagueIntelligence()
    if (!read.ok) return { data: null, error: read.error, source: 'live', timestamp: read.timestamp }
    // An empty array is an answer here, not a missing one — see `toRisks`.
    return { data: toRisks(read.intel), error: null, source: 'live', timestamp: read.timestamp }
  },

  async getEvidence() {
    if (!(await isLiveReady('league-health'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp }
    }

    const { data, error } = await callDecisionOS<LeagueIntelligenceNarrativeShape>(
      'league-health',
      `/api/v1/intelligence/league?leagueId=${encodeURIComponent(leagueId)}`,
    )
    if (error || !data) {
      return { data: null, error: error ?? notYetIntegrated(), source: 'live', timestamp }
    }

    return { data: toEvidencePoints(data.data.healthNarrative), error: null, source: 'live', timestamp }
  },

  /*
   * Delegated, not re-mapped — see this file's header. The `source` is rewritten to keep the
   * envelope honest about which module the caller asked, while the data and any error pass through
   * untouched.
   */
  async getRecommendations() {
    if (!(await isLiveReady('league-health'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const queue = await liveRecommendationsClient.getQueue()
    return { data: queue.data, error: queue.error, source: 'live', timestamp: queue.timestamp }
  },
}
