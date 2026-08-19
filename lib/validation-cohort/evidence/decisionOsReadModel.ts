/**
 * Fantasy OS Suite — Phase V8.2: Decision OS read-compatibility model.
 *
 * Demonstrates that the expanded, provider-neutral evidence corpus can FEED the existing Decision OS seams
 * — compatibility verification only, NOT recommendation logic and NO tuning. Each entry reports whether an
 * Operating System can consume the persisted evidence and names the concrete evidence it reads; a missing
 * provider-neutral contract is reported as a documented gap, never papered over with invented values.
 */
import type { OperatingSystemKey } from '../types'
import { probeLeague } from '../decisionOsProbe'
import type { PersistedLeagueEvidence } from '../persistence/evidenceStore'

export type OsCompat = {
  os: OperatingSystemKey
  available: boolean
  evidence: string
  missingContract?: string
}

/** Per-league read-compatibility across the six league-scoped Operating Systems. */
export function buildLeagueReadModel(ev: PersistedLeagueEvidence): OsCompat[] {
  const out: OsCompat[] = []
  const b = ev.bundle
  const a = ev.activity

  // Commissioner OS + League OS — the existing pure health seam consumes the neutral facts unchanged.
  if (ev.facts) {
    const { health } = probeLeague(ev.facts)
    const ok = !!health
    out.push({ os: 'commissioner', available: ok, evidence: ok ? `league-health status=${health!.overallStatus}` : '', missingContract: ok ? undefined : 'league-health facts' })
    out.push({ os: 'league', available: ok, evidence: ok ? `engagement=${health!.engagementScore} fairness=${health!.fairnessScore}` : '', missingContract: ok ? undefined : 'league-analytics facts' })
  } else {
    out.push({ os: 'commissioner', available: false, evidence: '', missingContract: 'NormalizedLeagueFacts' })
    out.push({ os: 'league', available: false, evidence: '', missingContract: 'NormalizedLeagueFacts' })
  }

  // Manager OS — roster membership + weekly matchups provide a manager's team context.
  const managerOk = !!b && (b.rosterMembership.length > 0 || b.matchups.length > 0)
  out.push({ os: 'manager', available: managerOk, evidence: managerOk ? `rosters=${b!.rosterMembership.length} matchups=${b!.matchups.length}` : '', missingContract: managerOk ? undefined : 'roster/matchup evidence' })

  // Trade OS — completed trade activity.
  const tradeOk = !!a
  out.push({ os: 'trade', available: tradeOk, evidence: tradeOk ? `trades=${a!.totalCompletedTrades} participants=${a!.managersParticipatingInTrades}` : '', missingContract: tradeOk ? undefined : 'trade activity evidence' })

  // Waiver OS — waiver + FAAB activity.
  out.push({ os: 'waiver', available: tradeOk, evidence: tradeOk ? `waivers=${a!.waiverFrequency} faab=${a!.completedFaabSpending ?? 'n/a'}` : '', missingContract: tradeOk ? undefined : 'waiver activity evidence' })

  // Draft OS — draft participation.
  const draftOk = !!a
  out.push({ os: 'draft', available: draftOk, evidence: draftOk ? `draftPresent=${a!.draftParticipation.present} complete=${a!.draftParticipation.complete}` : '', missingContract: draftOk ? undefined : 'draft participation evidence' })

  return out
}

/** Platform OS — corpus-level portfolio aggregation across every persisted league. */
export function buildPlatformReadModel(all: PersistedLeagueEvidence[]): OsCompat {
  const withHealth = all.filter((e) => !!e.facts)
  const available = withHealth.length > 0
  return {
    os: 'platform',
    available,
    evidence: available ? `leagues=${all.length} withFacts=${withHealth.length} seasons=${new Set(all.map((e) => e.season)).size}` : '',
    missingContract: available ? undefined : 'no league facts to aggregate',
  }
}
