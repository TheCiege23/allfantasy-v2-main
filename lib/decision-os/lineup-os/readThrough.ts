import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { loadLineupWarehouseFacts, type LineupWarehouseFacts } from '../lineup/warehouseFacts'
import { loadLineupSignalFacts, type LineupSignalFacts } from '../lineup/signalFacts'
import { createLineupOsStore, lineupOsScope, type LineupOsStore } from './store'

type PrismaLike = typeof defaultPrisma

/**
 * Lineup OS — the read-through seam.
 *
 * `runLineupShadow` already takes `loadWarehouseFacts` / `loadSignalFacts` as optional dependencies
 * with live defaults. So the Lineup OS plugs in by supplying different loaders: THE DECISION PATH
 * IS NOT MODIFIED AT ALL. Nothing about how a lineup decision is made changes; only where its
 * grounding facts come from when a fresh copy is already on hand.
 *
 * Order is always: fresh store hit → otherwise the live loader → otherwise null (which the existing
 * contract already degrades to uncertainty entries rather than zeros).
 *
 * A live result is written back, so the first caller after an expiry pays the cost once and the
 * next ones do not. That is the only "gathering" this PoC does on its own; a scheduler calling
 * `refreshLineupOsLeague` is what makes it continuous, and there is no working scheduler today.
 */

export interface LineupOsOutcome {
  /** Where the facts came from — for telemetry and for judging whether the store is earning its keep. */
  servedFrom: 'store' | 'live' | 'unavailable'
  ageMs: number | null
}

export interface LineupOsLoaders {
  loadWarehouseFacts: (args: {
    leagueId: string
    sport: string
    userId: string
    playerIds: string[]
  }) => Promise<LineupWarehouseFacts | null>
  loadSignalFacts: (args: {
    leagueId: string
    sport: string
    week: number
    players: { playerId: string; playerName: string; team?: string | null }[]
  }) => Promise<LineupSignalFacts | null>
  /** Drained by the caller after a decision to record how the facts were sourced. */
  drainOutcomes: () => Record<string, LineupOsOutcome>
}

export interface LineupOsDeps {
  store?: LineupOsStore
  liveWarehouse?: typeof loadLineupWarehouseFacts
  liveSignal?: typeof loadLineupSignalFacts
}

/**
 * Guarded access to whatever store was injected.
 *
 * The production store already swallows its own failures, but relying on that makes the safety a
 * property of ONE implementation rather than of this seam. A store that throws would convert an
 * accelerator into a new way for the lineup decision to fail — and these loaders are documented as
 * never throwing. Caught by the test that injects a throwing store.
 */
async function safeRead<T>(
  store: LineupOsStore,
  args: { leagueId: string; kind: 'warehouse' | 'signal'; scopeKey: string },
): Promise<{ facts: T; capturedAt: Date; ageMs: number } | null> {
  try {
    return await store.read<T>(args)
  } catch {
    return null
  }
}

async function safeWrite(store: LineupOsStore, args: Parameters<LineupOsStore['write']>[0]): Promise<void> {
  try {
    await store.write(args)
  } catch {
    // Populating the cache must never fail the caller that produced the facts.
  }
}

/**
 * Build loaders that prefer maintained state and fall back to live derivation.
 *
 * ⚠ Never returns a stale entry: `store.read` enforces the TTL and reports a miss past it, so a
 * cold store behaves exactly like today's code rather than like today's code with old data.
 */
export function createLineupOsLoaders(deps: LineupOsDeps = {}): LineupOsLoaders {
  const store = deps.store ?? createLineupOsStore()
  const liveWarehouse = deps.liveWarehouse ?? loadLineupWarehouseFacts
  const liveSignal = deps.liveSignal ?? loadLineupSignalFacts
  const outcomes: Record<string, LineupOsOutcome> = {}

  return {
    async loadWarehouseFacts(args) {
      const scopeKey = lineupOsScope.warehouse(args.userId)
      const hit = await safeRead<LineupWarehouseFacts>(store, { leagueId: args.leagueId, kind: 'warehouse', scopeKey })
      if (hit) {
        outcomes.warehouse = { servedFrom: 'store', ageMs: hit.ageMs }
        return hit.facts
      }
      const live = await liveWarehouse(args).catch(() => null)
      outcomes.warehouse = { servedFrom: live ? 'live' : 'unavailable', ageMs: live ? 0 : null }
      // Only a real result is cached. Caching null would turn a transient source outage into a
      // TTL-long blackout, and "unavailable" is a fact about the source, not about the league.
      if (live) await safeWrite(store, { leagueId: args.leagueId, sport: args.sport, kind: 'warehouse', scopeKey, facts: live })
      return live
    },

    async loadSignalFacts(args) {
      const scopeKey = lineupOsScope.signal(args.week)
      const hit = await safeRead<LineupSignalFacts>(store, { leagueId: args.leagueId, kind: 'signal', scopeKey })
      if (hit) {
        outcomes.signal = { servedFrom: 'store', ageMs: hit.ageMs }
        return hit.facts
      }
      const live = await liveSignal(args).catch(() => null)
      outcomes.signal = { servedFrom: live ? 'live' : 'unavailable', ageMs: live ? 0 : null }
      if (live) await safeWrite(store, { leagueId: args.leagueId, sport: args.sport, kind: 'signal', scopeKey, facts: live })
      return live
    },

    drainOutcomes() {
      const copy = { ...outcomes }
      for (const k of Object.keys(outcomes)) delete outcomes[k]
      return copy
    },
  }
}

export interface LineupOsRefreshResult {
  leagueId: string
  warehouse: 'written' | 'unavailable'
  signal: 'written' | 'unavailable'
  elapsedMs: number
}

/**
 * Populate the store for one league — the "constantly gathering" half, minus a scheduler.
 *
 * Callable today by hand or from a maintenance route; intended to be driven on a schedule once one
 * exists. Never throws: a refresh is opportunistic, and a failure must leave the read path exactly
 * as it was rather than break it.
 */
export async function refreshLineupOsLeague(
  args: {
    leagueId: string
    sport: string
    userId: string
    week: number
    playerIds: string[]
    players: { playerId: string; playerName: string; team?: string | null }[]
  },
  deps: LineupOsDeps & { db?: PrismaLike; now?: () => number } = {},
): Promise<LineupOsRefreshResult> {
  const started = (deps.now ?? Date.now)()
  const store = deps.store ?? createLineupOsStore(deps.db)
  const liveWarehouse = deps.liveWarehouse ?? loadLineupWarehouseFacts
  const liveSignal = deps.liveSignal ?? loadLineupSignalFacts

  let warehouse: LineupOsRefreshResult['warehouse'] = 'unavailable'
  let signal: LineupOsRefreshResult['signal'] = 'unavailable'

  try {
    const w = await liveWarehouse({
      leagueId: args.leagueId, sport: args.sport, userId: args.userId, playerIds: args.playerIds,
    }).catch(() => null)
    if (w) {
      await safeWrite(store, {
        leagueId: args.leagueId, sport: args.sport, kind: 'warehouse',
        scopeKey: lineupOsScope.warehouse(args.userId), facts: w,
      })
      warehouse = 'written'
    }
  } catch {
    // opportunistic
  }

  try {
    const s = await liveSignal({
      leagueId: args.leagueId, sport: args.sport, week: args.week, players: args.players,
    }).catch(() => null)
    if (s) {
      await safeWrite(store, {
        leagueId: args.leagueId, sport: args.sport, kind: 'signal',
        scopeKey: lineupOsScope.signal(args.week), facts: s,
      })
      signal = 'written'
    }
  } catch {
    // opportunistic
  }

  return { leagueId: args.leagueId, warehouse, signal, elapsedMs: (deps.now ?? Date.now)() - started }
}
