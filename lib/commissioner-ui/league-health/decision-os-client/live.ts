import { callDecisionOS } from '../../adapter/transport'
import { isLiveReady } from '../../liveReadiness'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import type { CommissionerErrorContract } from '../../contracts'
import type { LeagueHealthClient, LeagueHealthEvidencePoint } from './types'

/**
 * Phase 3.5 — League Health's first real (gated) integration, following
 * Mission Control's exact established pattern (Phase 3.2/3.4;
 * see lib/commissioner-ui/MISSION_CONTROL_COMPLETION_REPORT.md).
 *
 * Only `getEvidence()` gets real wiring in this phase. The other 3 methods
 * stay on the honest placeholder because their required fields have no
 * analog anywhere in the real Decision OS backend, and inventing one would
 * violate this phase's own "do not introduce new backend capabilities"
 * constraint — verified field-by-field, not assumed:
 *
 * - `getHealthDetail()`'s `baseline`/`deductions` imply a baseline-minus-
 *   deductions scoring MODEL. The real score is a single computed number
 *   (`leagueEngagementScore`) with no such decomposition anywhere —
 *   backfilling a fake `baseline: 100` and reverse-engineering `deductions`
 *   to match would present a false causal story for the score, not a
 *   presentation of real data. `subScores.retention`/`.competitiveBalance`
 *   also have no real analog: Decision OS's `retentionRisk` is a category
 *   (low/medium/high/critical), not a numeric score, and no standings/
 *   competitive-balance signal exists anywhere in behavioral intelligence.
 * - `getRisks()`'s `ageInDays`/`status: 'new'|'ongoing'|'resolving'` imply
 *   persisted risk-lifecycle tracking. Decision OS's recommendations are
 *   recomputed fresh from the current event window on every request —
 *   there is no "when was this first identified" timestamp or status
 *   machine anywhere to draw from.
 * - `getRecommendations()`'s `confidence`/`expectedImpact`/
 *   `primaryActionLabel`/`status` have no per-recommendation analog either.
 *   (`completeness` exists, but it's a *data-quality* score for the whole
 *   league, not a confidence signal for one specific recommendation —
 *   presenting it as `confidence` would conflate two different concepts
 *   under an inference dressed up as real data.)
 *
 * `getEvidence()`'s `{ label, detail }[]` shape has no such rigid schema —
 * it's free-text evidence, and Phase 3.3's `healthNarrative` (real,
 * already-computed `engagementSummary`/`topConcern`/`standoutSignal`) maps
 * onto it directly and completely, with nothing missing.
 */
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

export const liveLeagueHealthClient: LeagueHealthClient = {
  async getHealthDetail() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },

  async getRisks() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
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

  async getRecommendations() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },
}
