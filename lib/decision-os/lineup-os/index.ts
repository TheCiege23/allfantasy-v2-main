import 'server-only'

import { loadLineupWarehouseFacts, type LineupWarehouseFacts } from '../lineup/warehouseFacts'
import { loadLineupSignalFacts, type LineupSignalFacts } from '../lineup/signalFacts'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS, MINUTES } from '../domain-os/types'

/**
 * Lineup OS — maintained fact state for `manager.lineup.set`.
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-os/*` points the other way — its `decision-os-client`
 * modules call INTO Decision OS to render a surface. Same "OS" suffix, opposite arrow.
 *
 * WHY THIS DOMAIN IS THE ONE THAT PAYS
 * `computeLineupActionsForUser` fans out across a user's leagues and rosters on every call — the
 * reason the shadow sweep runs 3 users on a 20s budget, and the same shape as the unbounded
 * per-league fan-out that took production Postgres to an OOM (53200). The warehouse and signal
 * loaders then query the ports inline on top of that.
 *
 * NOTHING ABOUT THE DECISION CHANGES. `runLineupShadow` already accepts `loadWarehouseFacts` and
 * `loadSignalFacts` as optional dependencies with live defaults, so this plugs in by supplying
 * different loaders. Only where the grounding comes from changes, never how a lineup is decided.
 */

export type LineupWarehouseArgs = {
  leagueId: string
  sport: string
  userId: string
  playerIds: string[]
}

export type LineupSignalArgs = {
  leagueId: string
  sport: string
  week: number
  players: { playerId: string; playerName: string; team?: string | null }[]
}

/**
 * Season aggregates and completed-matchup history, cited for THIS manager's roster.
 *
 * User level, and long-lived: these numbers do not move within a day.
 */
export const lineupWarehouseSource: OsFactSource<LineupWarehouseArgs, LineupWarehouseFacts> = {
  kind: 'warehouse',
  level: 'user',
  ttlMs: 6 * HOURS,
  scopeKey: (a) => `${a.userId}:${a.leagueId}`,
  sport: (a) => a.sport,
  derive: (a) => loadLineupWarehouseFacts(a).catch(() => null),
  // `performance` is null when NO roster player has history — which is not the same as zero games,
  // so sample is only reported when there is something to count.
  measure: (f) => ({
    sampleSize: f.performance ? f.performance.playersWithHistory : null,
    confidence: f.performance && f.performance.totalPlayers > 0
      ? f.performance.playersWithHistory / f.performance.totalPlayers
      : null,
  }),
}

/**
 * Injury, bye, projections, weather, news for the decision week.
 *
 * League level (the week's facts are shared by everyone in it) and SHORT-lived: these decide
 * whether a player can be started at all. Serving a stale injury status is a wrong answer
 * delivered confidently, which is exactly the failure maintained state introduces if allowed to go
 * stale — hence a TTL twelve times shorter than the warehouse one.
 */
export const lineupSignalSource: OsFactSource<LineupSignalArgs, LineupSignalFacts> = {
  kind: 'signal',
  level: 'league',
  ttlMs: 30 * MINUTES,
  scopeKey: (a) => `${a.leagueId}:w${a.week}`,
  sport: (a) => a.sport,
  derive: (a) => loadLineupSignalFacts(a).catch(() => null),
  measure: (f) => ({
    sampleSize: f.injury ? f.injury.resolvedCount : null,
    confidence: f.injury && f.injury.totalPlayers > 0 ? f.injury.resolvedCount / f.injury.totalPlayers : null,
  }),
}

export function createLineupOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('lineup', deps)
}

/**
 * Loaders shaped for `runLineupShadow`'s dependency slots, so the feed can be adopted without
 * touching the decision path.
 */
export function createLineupOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createLineupOs(deps)
  return {
    loadWarehouseFacts: (args: LineupWarehouseArgs) => feed.get(lineupWarehouseSource, args),
    loadSignalFacts: (args: LineupSignalArgs) => feed.get(lineupSignalSource, args),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const lineupOsSources = [lineupWarehouseSource, lineupSignalSource] as const
