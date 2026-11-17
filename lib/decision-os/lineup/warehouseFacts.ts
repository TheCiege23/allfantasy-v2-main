import { projectPerformanceContext } from '@/lib/decision-os/world/performanceEnrichedWorld'
import { projectMatchupContext, type MatchupContext } from '@/lib/decision-os/world/matchupEnrichedWorld'
import type { RawMatchupFactRow, RawPlayerGameFactRow } from '@/lib/decision-os/world/facts'

interface CitedPlayerPerformance {
  playerId: string
  gamesPlayed: number
  avgFantasyPoints: number
  recentFormAvg: number
  seasonUsed: number | null
}

export interface LineupWarehouseFacts {
  /** null = performance history unavailable for every roster player (NOT zero games). */
  performance: {
    playersWithHistory: number
    totalPlayers: number
    seasonUsed: number | null
    seasonMismatch: boolean
    /** Up to 2 strongest cited samples — real stored numbers for the explainability sentence. */
    cited: CitedPlayerPerformance[]
  } | null
  /** null = no completed matchup history for this team (the NORMAL path — sparse coverage). */
  matchup: MatchupContext | null
  uncertainty: string[]
}

/** Pure projection from already-loaded rows. Exported for fixture-driven tests. */
export function projectLineupWarehouseFacts(args: {
  performanceRows: RawPlayerGameFactRow[]
  matchupRows: RawMatchupFactRow[]
  playerIds: string[]
  teamId: string | null
  leagueSeason: number
}): LineupWarehouseFacts {
  const uncertainty: string[] = []

  // ── F2.9 performance ────────────────────────────────────────────────
  const rowsByPlayer = new Map<string, RawPlayerGameFactRow[]>()
  for (const row of args.performanceRows) {
    const list = rowsByPlayer.get(row.playerId)
    if (list) list.push(row)
    else rowsByPlayer.set(row.playerId, [row])
  }

  let playersWithHistory = 0
  let seasonUsed: number | null = null
  let seasonMismatch = false
  const cited: CitedPlayerPerformance[] = []
  for (const playerId of args.playerIds) {
    const context = projectPerformanceContext(rowsByPlayer.get(playerId) ?? [], String(args.leagueSeason))
    if (context.gamesPlayed == null) continue
    playersWithHistory += 1
    if (context.seasonUsed != null) seasonUsed = context.seasonUsed
    if (context.uncertainty.some((u) => u.startsWith('season_mismatch'))) seasonMismatch = true
    cited.push({
      playerId,
      gamesPlayed: context.gamesPlayed,
      avgFantasyPoints: context.avgFantasyPoints ?? 0,
      recentFormAvg: context.recentFormAvg ?? 0,
      seasonUsed: context.seasonUsed,
    })
  }
  cited.sort((a, b) => b.recentFormAvg - a.recentFormAvg)

  const performance = playersWithHistory > 0
    ? {
        playersWithHistory,
        totalPlayers: args.playerIds.length,
        seasonUsed,
        seasonMismatch,
        cited: cited.slice(0, 2),
      }
    : null
  if (performance == null) {
    uncertainty.push('warehouse_performance_unavailable: no stored game history for any roster player')
  } else if (seasonMismatch) {
    uncertainty.push(`warehouse_season_mismatch: stored performance covers ${seasonUsed}, league season is ${args.leagueSeason}`)
  }

  // ── F2.10 matchup ───────────────────────────────────────────────────
  const matchupContext = projectMatchupContext(args.matchupRows, args.teamId, args.leagueSeason)
  const matchup = matchupContext.latestCompletedMatchup != null ? matchupContext : null
  if (matchup == null) {
    // Sparse coverage is the NORMAL path (ADR F2.10 policy 1).
    uncertainty.push('warehouse_matchup_unavailable: no completed matchup history stored for this team')
  } else {
    for (const entry of matchupContext.uncertainty) uncertainty.push(`warehouse_${entry}`)
  }

  return { performance, matchup, uncertainty }
}

