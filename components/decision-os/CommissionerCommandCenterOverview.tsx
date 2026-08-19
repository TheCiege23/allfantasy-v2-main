'use client'
/**
 * Fantasy OS Suite — Phase OS-B1: Commissioner Multi-League Command Center.
 *
 * "What requires my attention today?" — the top-level answer, in four numbers. Deliberately not a
 * wall of metrics: total leagues (ordinary AF count, always known), leagues with a real Decision OS
 * read on them ("tracked" rather than an invented "active season" concept this codebase has no real
 * signal for), leagues needing attention (Decision OS's own watch/at_risk/critical bucketing), and
 * drafts approaching (AF-native `LeagueSettings.draftDateUtc` only — honestly excludes Sleeper
 * leagues, which have no persisted draft date anywhere in this codebase today).
 */
import { AlertTriangle, CalendarClock, ShieldCheck, Trophy } from 'lucide-react'
import { DecisionOsStatChip } from './DecisionOsCardPrimitives'

type CommissionerCommandCenterOverviewProps = {
  totalLeagues: number
  trackedLeagueCount: number
  leaguesNeedingAttentionCount: number
  draftsApproachingCount: number
}

// Phase V1.0: the local StatChip here was byte-for-byte identical to ManagerCommandCenterOverview's own
// copy — deduplicated into `DecisionOsStatChip` (`DecisionOsCardPrimitives.tsx`). Only visible diff: the
// warning-tone border opacity now matches the shared tone system (25% instead of a locally-picked 30%).
const StatChip = DecisionOsStatChip

export default function CommissionerCommandCenterOverview({
  totalLeagues,
  trackedLeagueCount,
  leaguesNeedingAttentionCount,
  draftsApproachingCount,
}: CommissionerCommandCenterOverviewProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="command-center-overview">
      <StatChip icon={Trophy} label="Total leagues" value={totalLeagues} />
      <StatChip icon={ShieldCheck} label="Actively monitored" value={trackedLeagueCount} />
      <StatChip icon={AlertTriangle} label="Need attention" value={leaguesNeedingAttentionCount} tone="risk" />
      <StatChip icon={CalendarClock} label="Drafts approaching" value={draftsApproachingCount} />
    </div>
  )
}
