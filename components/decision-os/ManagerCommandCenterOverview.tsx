'use client'
/**
 * Fantasy OS Suite — Phase OS-C1: Manager Operating System Foundation.
 *
 * "What needs my attention today, across every team I play in?" — the manager-facing mirror of
 * `CommissionerCommandCenterOverview.tsx`, same 4-stat-chip layout and visual language. Total
 * leagues (ordinary AF count, always known), leagues with a real Decision OS read on them
 * ("tracked"), leagues needing attention (Manager OS's own retention-risk/inactivity bucketing), and
 * drafts approaching (same real `LeagueSettings.draftDateUtc` source Commissioner OS already uses,
 * counted across every league this user belongs to rather than just the ones they commission).
 */
import { AlertTriangle, CalendarClock, ShieldCheck, Trophy } from 'lucide-react'
import { DecisionOsStatChip } from './DecisionOsCardPrimitives'

type ManagerCommandCenterOverviewProps = {
  totalLeagues: number
  trackedLeagueCount: number
  leaguesNeedingAttentionCount: number
  draftsApproachingCount: number
}

// Phase V1.0: the local StatChip here was byte-for-byte identical to CommissionerCommandCenterOverview's
// own copy — deduplicated into `DecisionOsStatChip` (`DecisionOsCardPrimitives.tsx`). Only visible diff: the
// warning-tone border opacity now matches the shared tone system (25% instead of a locally-picked 30%).
const StatChip = DecisionOsStatChip

export default function ManagerCommandCenterOverview({
  totalLeagues,
  trackedLeagueCount,
  leaguesNeedingAttentionCount,
  draftsApproachingCount,
}: ManagerCommandCenterOverviewProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="manager-command-center-overview">
      <StatChip icon={Trophy} label="Total leagues" value={totalLeagues} />
      <StatChip icon={ShieldCheck} label="Actively monitored" value={trackedLeagueCount} />
      <StatChip icon={AlertTriangle} label="Need attention" value={leaguesNeedingAttentionCount} tone="risk" />
      <StatChip icon={CalendarClock} label="Drafts approaching" value={draftsApproachingCount} />
    </div>
  )
}
