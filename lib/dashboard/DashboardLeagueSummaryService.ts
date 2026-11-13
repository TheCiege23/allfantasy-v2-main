/**
 * DashboardLeagueSummaryService — aggregate league counts and group leagues by sport for dashboard.
 * Uses DashboardSportGroupingService for display order (NFL, NHL, NBA, MLB, NCAA Football, NCAA Basketball, Soccer).
 */

import { groupLeaguesBySport, type LeagueForGrouping, type SportGroup } from "./DashboardSportGroupingService"

interface LeagueSummaryCounts {
  totalLeagues: number
  totalBracketPools: number
  totalBracketEntries: number
}

export interface DashboardLeagueSummaryInput {
  /** App/synced leagues (from /api/league/list). */
  appLeagues?: LeagueForGrouping[]
  /** Bracket leagues (pools) the user is in. */
  bracketLeagues?: { id: string; name: string; tournamentId?: string; memberCount?: number }[]
  /** Bracket entries. */
  bracketEntries?: { id: string; name: string; tournamentId: string; score?: number }[]
}

/** Group app leagues by sport for dashboard sections. */
export function getAppLeaguesBySport(leagues: LeagueForGrouping[]): SportGroup[] {
  return groupLeaguesBySport(leagues)
}

/** Compute summary counts for dashboard. */
export function getLeagueSummaryCounts(input: DashboardLeagueSummaryInput): LeagueSummaryCounts {
  return {
    totalLeagues: input.appLeagues?.length ?? 0,
    totalBracketPools: input.bracketLeagues?.length ?? 0,
    totalBracketEntries: input.bracketEntries?.length ?? 0,
  }
}
