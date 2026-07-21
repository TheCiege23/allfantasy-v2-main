import 'server-only'

/**
 * League Health Center section data.
 *
 * A pure reshape of the already-resolved `MissionControlSnapshot` — it issues
 * no query of its own. The score projection reuses `summarizeHealth`, the exact
 * mapping the Overview card uses, so the dedicated Health section and the
 * Overview health card can never show the same score differently.
 *
 * Server-only because it imports the value `summarizeHealth` from the
 * server-only overview loader. The client section imports only its TYPE, which
 * is elided at compile time, so no server code reaches the browser bundle.
 */
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { ManagerAtRetentionRisk } from '@/lib/decision-os/leagueHealthAlignment'
import type { LeagueActivityTrendSummary } from '@/lib/decision-os/dashboard-intelligence'
import { summarizeHealth, type LeagueHealthSummary } from './overview'

export interface LeagueHealthSectionData {
  health: LeagueHealthSummary | null
  trend: LeagueActivityTrendSummary
  managersAtRetentionRisk: ManagerAtRetentionRisk[]
  warnings: string[]
}

const EMPTY_TREND: LeagueActivityTrendSummary = { available: false, reason: 'no_snapshots' }

export function buildLeagueHealthSection(args: {
  snapshot: MissionControlSnapshot | null
  entitledToIntelligence: boolean
}): LeagueHealthSectionData {
  if (!args.entitledToIntelligence) {
    return { health: null, trend: EMPTY_TREND, managersAtRetentionRisk: [], warnings: [] }
  }

  const snapshot = args.snapshot
  if (!snapshot) {
    return {
      health: null,
      trend: EMPTY_TREND,
      managersAtRetentionRisk: [],
      warnings: ['League health could not be resolved right now.'],
    }
  }

  if (!snapshot.leagueHealth.available) {
    return {
      health: null,
      trend: snapshot.trend,
      managersAtRetentionRisk: snapshot.managersAtRetentionRisk,
      warnings: [
        'Not enough league activity has been recorded to calculate a health score yet.',
      ],
    }
  }

  return {
    health: summarizeHealth(snapshot.leagueHealth.result),
    trend: snapshot.trend,
    managersAtRetentionRisk: snapshot.managersAtRetentionRisk,
    warnings: [],
  }
}
