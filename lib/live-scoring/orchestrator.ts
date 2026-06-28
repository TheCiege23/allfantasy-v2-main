/**
 * Live Scoring — incremental polling orchestrator (G11 Phase 3).
 *
 * The single, reusable platform tick that powers live scoring for EVERY concept
 * (Redraft, Dynasty, Keeper, Best Ball, Guillotine, Survivor, Big Brother, Devy,
 * C2C, Zombie, Tournament, IDP). It composes the Phase 2 engine primitives —
 * `resolvePollCadence` (when/whether to poll), `diffChangedPlayers` (idempotent
 * no-op on unchanged data), and `planIncrementalRescore` (only affected
 * rosters/matchups/standings) — into one deterministic flow:
 *
 *   cadence → fetch ONLY active games → diff changed players → plan incremental
 *   rescore → persist only changes → apply only affected recompute → broadcast
 *   only affected entities.
 *
 * Pure orchestration: all I/O (provider fetch, stat store, rescore, broadcast) is
 * injected, so it is unit-testable without a DB or network and a concept supplies
 * its own bindings. No second polling implementation — this is THE scheduler.
 */

import { resolvePollCadence } from '@/lib/live-scoring/cadence'
import { diffChangedPlayers } from '@/lib/live-scoring/rescorePlan'
import { planIncrementalRescore } from '@/lib/live-scoring/rescorePlan'
import type {
  RescorePlan,
  RescoreRosterInput,
  RescoreMatchupInput,
} from '@/lib/live-scoring/rescorePlan'
import type { LiveGameSnapshot, PollCadenceDecision } from '@/lib/live-scoring/types'

/** Canonical entity-change events broadcast over SSE — only affected entities. */
export type LiveBroadcastEvent =
  | { eventType: 'player_changed'; meta: { playerId: string; rosterId: string } }
  | { eventType: 'matchup_changed'; meta: { matchupId: string } }
  | { eventType: 'projection_changed'; meta: { rosterId: string } }
  | { eventType: 'standings_changed'; meta: Record<string, never> }
  | { eventType: 'league_changed'; meta: { changedPlayers: number; changedMatchups: number } }

/** Topology needed to map changed players → affected rosters/matchups. */
export type LiveTickTopology = {
  rosters: RescoreRosterInput[]
  matchups: RescoreMatchupInput[]
}

export type LiveTickDeps = {
  /** Fetch raw stat lines for the given active games' players. Active games only. */
  fetchActiveStats: (gameIds: readonly string[]) => Promise<Map<string, Record<string, number>>>
  /** Last-persisted stat snapshot for the diff (idempotency / correction detection). */
  loadPreviousStats: () => Promise<ReadonlyMap<string, Record<string, number>>>
  /** Roster/matchup topology so the plan can scope work. */
  loadTopology: () => Promise<LiveTickTopology>
  /** Persist ONLY the changed stat lines (batched by the binding). */
  persistChangedStats: (changed: Map<string, Record<string, number>>) => Promise<void>
  /** Recompute ONLY the affected matchups/standings (incremental). */
  applyRescore: (plan: RescorePlan) => Promise<void>
  /** Broadcast the affected-entity events (e.g. via leagueRealtimeStore). */
  broadcast: (events: readonly LiveBroadcastEvent[]) => void | Promise<void>
}

export type LiveTickResult = {
  cadence: PollCadenceDecision
  /** Whether any provider fetch happened this tick. */
  polled: boolean
  changedPlayerIds: string[]
  plan: RescorePlan
  events: LiveBroadcastEvent[]
  /** Delay until the next tick (ms); 0 = stop. Mirrors the cadence decision. */
  nextPollDelayMs: number
  reason: string
}

/**
 * Build the affected-entity broadcast events from a rescore plan. Pure.
 *
 * Emits exactly one `player_changed` per (changed player × affected roster it
 * starts on), one `projection_changed` per affected roster, one `matchup_changed`
 * per affected matchup, one `standings_changed` only when a final matchup moved,
 * and a single `league_changed` umbrella. Nothing for unaffected entities.
 */
export function buildLiveBroadcastEvents(
  plan: RescorePlan,
  changedPlayerIds: readonly string[],
  rosters: readonly RescoreRosterInput[],
): LiveBroadcastEvent[] {
  if (plan.noop) return []
  const changed = new Set(changedPlayerIds)
  const affectedRosters = new Set(plan.affectedRosterIds)
  const events: LiveBroadcastEvent[] = []

  for (const roster of rosters) {
    if (!affectedRosters.has(roster.rosterId)) continue
    for (const playerId of roster.scoringPlayerIds) {
      if (changed.has(playerId)) {
        events.push({ eventType: 'player_changed', meta: { playerId, rosterId: roster.rosterId } })
      }
    }
    events.push({ eventType: 'projection_changed', meta: { rosterId: roster.rosterId } })
  }

  for (const matchupId of plan.affectedMatchupIds) {
    events.push({ eventType: 'matchup_changed', meta: { matchupId } })
  }

  if (plan.standingsImpacted) {
    events.push({ eventType: 'standings_changed', meta: {} })
  }

  events.push({
    eventType: 'league_changed',
    meta: { changedPlayers: events.filter((e) => e.eventType === 'player_changed').length, changedMatchups: plan.affectedMatchupIds.length },
  })

  return events
}

/**
 * Run one live-scoring tick. Deterministic given `games`, `now`, and the deps.
 *
 * Skips entirely when no game is active (no fetch for finalized games / empty
 * weeks). Idempotent: an unchanged poll detects zero changed players and does no
 * persist/rescore/broadcast. Incremental: only changed players are persisted and
 * only affected rosters/matchups/standings are recomputed and broadcast.
 */
export async function runLiveScoringTick(
  games: readonly LiveGameSnapshot[],
  deps: LiveTickDeps,
  now: Date = new Date(),
): Promise<LiveTickResult> {
  const cadence = resolvePollCadence(games, now)
  const base = {
    cadence,
    nextPollDelayMs: cadence.nextPollDelayMs,
    reason: cadence.reason,
    plan: { affectedRosterIds: [], affectedMatchupIds: [], standingsImpacted: false, noop: true } as RescorePlan,
    events: [] as LiveBroadcastEvent[],
    changedPlayerIds: [] as string[],
  }

  // No active games → never fetch (finalized games / empty weeks cost nothing).
  if (cadence.gameIdsToPoll.length === 0) {
    return { ...base, polled: false }
  }

  const [nextStats, previousStats] = await Promise.all([
    deps.fetchActiveStats(cadence.gameIdsToPoll),
    deps.loadPreviousStats(),
  ])

  const changedPlayerIds = diffChangedPlayers(previousStats, nextStats)
  // Idempotent: identical provider data → zero work, zero broadcast.
  if (changedPlayerIds.length === 0) {
    return { ...base, polled: true, reason: 'no_change' }
  }

  const changedStats = new Map<string, Record<string, number>>()
  for (const id of changedPlayerIds) {
    const s = nextStats.get(id)
    if (s) changedStats.set(id, s)
  }
  await deps.persistChangedStats(changedStats)

  const topology = await deps.loadTopology()
  const plan = planIncrementalRescore({
    changedPlayerIds,
    rosters: topology.rosters,
    matchups: topology.matchups,
  })

  // Changed players exist but none are on a scoring roster → nothing to recompute.
  if (plan.noop) {
    return { ...base, polled: true, changedPlayerIds, reason: 'changes_off_roster' }
  }

  await deps.applyRescore(plan)
  const events = buildLiveBroadcastEvents(plan, changedPlayerIds, topology.rosters)
  await deps.broadcast(events)

  return {
    cadence,
    polled: true,
    changedPlayerIds,
    plan,
    events,
    nextPollDelayMs: cadence.nextPollDelayMs,
    reason: cadence.reason,
  }
}
