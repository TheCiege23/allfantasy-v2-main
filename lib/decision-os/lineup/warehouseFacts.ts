/**
 * Decision OS — warehouse fact grounding for the `manager.lineup.set` SHADOW memo (ADR F2.10).
 *
 * Loads F2.9 PerformanceContext + F2.10 MatchupContext inputs through the world ports and
 * projects them into a compact, citable summary the lineup DCO can carry. ENRICHMENT ONLY:
 * these facts feed memo/uncertainty/provenance/explainability — the deterministic lineup
 * rules never read them, live behavior is unchanged, and absence degrades to uncertainty
 * entries (never zeros). Loader never throws.
 */
import { loadMatchupFactRows, loadPlayerGameFactRows } from '@/lib/decision-os/world/port'
import { projectPerformanceContext } from '@/lib/decision-os/world/performanceEnrichedWorld'
import { projectMatchupContext, type MatchupContext } from '@/lib/decision-os/world/matchupEnrichedWorld'
import type { RawMatchupFactRow, RawPlayerGameFactRow } from '@/lib/decision-os/world/facts'
import { prisma } from '@/lib/prisma'

export interface CitedPlayerPerformance {
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

/**
 * Load + project in one call for the shadow runner. The league's season anchors season
 * isolation (League.season is non-null by schema). Team identity uses the roster-identity
 * join's first hop only (LeagueTeam by owner) — when that cannot resolve, matchup facts are
 * honestly unavailable with `team_identity_unresolved` rather than guessed. Never throws.
 */
export async function loadLineupWarehouseFacts(args: {
  leagueId: string
  sport: string
  userId: string
  playerIds: string[]
}): Promise<LineupWarehouseFacts> {
  // allSettled with every element wrapped in an immediately-invoked async fn. Two failure
  // shapes must both be contained (the existing lineup-shadow suite catches either as
  // unhandled rejections): with `all`, one rejection orphans its rejected siblings; and a
  // SYNC throw during argument-array construction (e.g. a null prisma fake) aborts the call
  // before allSettled ever observes the promises already created. The async wrappers turn
  // every sync throw into a settled rejection; every failure becomes uncertainty.
  const [performance, matchup, team, league] = await Promise.allSettled([
    (async () => loadPlayerGameFactRows(args.sport, args.playerIds))(),
    (async () => loadMatchupFactRows(args.leagueId))(),
    (async () =>
      prisma.leagueTeam.findFirst({
        where: { leagueId: args.leagueId, platformUserId: args.userId },
        select: { id: true },
      }))(),
    (async () => prisma.league.findUnique({ where: { id: args.leagueId }, select: { season: true } }))(),
  ])

  const failures: string[] = []
  const reason = (r: PromiseRejectedResult) =>
    r.reason instanceof Error ? r.reason.message : String(r.reason)
  if (performance.status === 'rejected') failures.push(`performance: ${reason(performance)}`)
  if (matchup.status === 'rejected') failures.push(`matchup: ${reason(matchup)}`)
  if (team.status === 'rejected') failures.push(`team: ${reason(team)}`)
  if (league.status === 'rejected' || league.value == null) {
    return {
      performance: null,
      matchup: null,
      uncertainty: [
        league.status === 'rejected'
          ? `warehouse_port_error: league: ${reason(league)}`
          : 'warehouse_league_unresolved: league row not found; season isolation impossible',
        ...failures.map((f) => `warehouse_port_error: ${f}`),
      ],
    }
  }

  const facts = projectLineupWarehouseFacts({
    performanceRows: performance.status === 'fulfilled' ? performance.value : [],
    matchupRows: matchup.status === 'fulfilled' ? matchup.value : [],
    playerIds: args.playerIds,
    teamId: team.status === 'fulfilled' ? team.value?.id ?? null : null,
    leagueSeason: league.value.season,
  })
  for (const failure of failures) facts.uncertainty.push(`warehouse_port_error: ${failure}`)
  return facts
}
