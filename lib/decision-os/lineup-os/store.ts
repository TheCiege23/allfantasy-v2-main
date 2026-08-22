import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import type { LineupWarehouseFacts } from '../lineup/warehouseFacts'
import type { LineupSignalFacts } from '../lineup/signalFacts'

type PrismaLike = typeof defaultPrisma

/**
 * Lineup OS — maintained fact state for `manager.lineup.set`.
 *
 * WHAT THIS IS FOR
 * Today the lineup decision assembles its world on every request: `computeLineupActionsForUser`
 * fans out across a user's leagues and rosters, and the warehouse/signal loaders query the ports
 * inline. That is why the shadow sweep had to be capped at 3 users with a 20s budget, and it is the
 * same shape as the unbounded per-league fan-out that once took production Postgres to an OOM.
 *
 * The Lineup OS holds those facts instead, so the decision layer reads rather than derives.
 *
 * ⚠ DIRECTION — THIS IS NOT THE SAME KIND OF THING AS `lib/commissioner-os`.
 * `commissioner-os/*` are CONSUMERS: their `decision-os-client` modules call INTO Decision OS to
 * render a product surface. The Lineup OS points the other way — it FEEDS Decision OS. Same suffix,
 * opposite arrow. Read the direction before assuming the pattern.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * IT NEVER SERVES STALE FACTS, AND THAT IS THE WHOLE SAFETY ARGUMENT.
 *
 * Maintained state that stops refreshing is worse than slow-but-fresh computation, because it lies
 * with confidence instead of being slow. That risk is real here and not hypothetical: every
 * scheduled job in this repo is currently dead, so a store built to be topped up by a cron would
 * quietly serve month-old facts.
 *
 * So this is an ACCELERATOR, never a source of record. Past its TTL an entry is treated as absent
 * and the caller falls through to the live path. The worst case is the behaviour we already have;
 * there is no case where a decision is made on data the system believes is fresher than it is.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

/** The fact families the lineup decision consumes. One row per (league, kind, scope). */
export type LineupOsFactKind = 'warehouse' | 'signal'

export interface LineupOsEntry<T> {
  facts: T
  capturedAt: Date
  ageMs: number
}

/**
 * How long a captured fact stays servable.
 *
 * Deliberately SHORT and per-kind rather than one global number. Signals (injury, bye, weather)
 * decay much faster than season-to-date performance history, and a single TTL would have to be
 * tuned to the fastest-moving input, which would throw away most of the benefit for the slower one.
 */
export const LINEUP_OS_TTL_MS: Record<LineupOsFactKind, number> = {
  // Season aggregates and completed-matchup history: stable within a day.
  warehouse: 6 * 60 * 60 * 1000,
  // Injury / bye / projections move hour to hour and decide whether a player can be started.
  signal: 30 * 60 * 1000,
}

export interface LineupOsStore {
  read<T>(args: { leagueId: string; kind: LineupOsFactKind; scopeKey: string }): Promise<LineupOsEntry<T> | null>
  write(args: {
    leagueId: string
    sport: string
    kind: LineupOsFactKind
    scopeKey: string
    facts: unknown
  }): Promise<void>
}

function delegateOf(db: PrismaLike) {
  return (db as unknown as {
    lineupOsFacts?: {
      findUnique(args: unknown): Promise<Record<string, unknown> | null>
      upsert(args: unknown): Promise<unknown>
      deleteMany(args: unknown): Promise<{ count: number }>
    }
  }).lineupOsFacts
}

/**
 * The production store.
 *
 * Every method degrades to "no cached facts" on any failure. A cache that throws is worse than no
 * cache: it converts an accelerator into a new way for the decision path to fail, and the lineup
 * loaders are documented as never throwing.
 */
export function createLineupOsStore(db: PrismaLike = defaultPrisma): LineupOsStore {
  return {
    async read({ leagueId, kind, scopeKey }) {
      const delegate = delegateOf(db)
      // Absent until the migration is applied — callers must fall through, not crash.
      if (!delegate) return null
      try {
        const row = await delegate.findUnique({
          where: { leagueId_kind_scopeKey: { leagueId, kind, scopeKey } },
        })
        if (!row) return null
        const capturedAt = row.capturedAt as Date | undefined
        if (!capturedAt) return null
        const ageMs = Date.now() - capturedAt.getTime()
        // Expiry is enforced on READ, not by a sweeper. A sweeper that stops running would leave
        // expired rows servable, which is exactly the failure this design refuses to have.
        if (ageMs > LINEUP_OS_TTL_MS[kind]) return null
        return { facts: row.facts as never, capturedAt, ageMs }
      } catch {
        return null
      }
    },

    async write({ leagueId, sport, kind, scopeKey, facts }) {
      const delegate = delegateOf(db)
      if (!delegate) return
      try {
        await delegate.upsert({
          where: { leagueId_kind_scopeKey: { leagueId, kind, scopeKey } },
          create: { leagueId, sport, kind, scopeKey, facts: facts ?? undefined, capturedAt: new Date() },
          update: { facts: facts ?? undefined, capturedAt: new Date(), sport },
        })
      } catch {
        // Populating the cache must never fail the caller that produced the facts.
      }
    },
  }
}

/** Scope discriminators. Kept in one place so a writer and a reader cannot disagree about the key. */
export const lineupOsScope = {
  /** Warehouse facts are per USER within a league — they cite that manager's roster. */
  warehouse: (userId: string) => `user:${userId}`,
  /** Signal facts are per WEEK within a league — injury/bye/projection are week-scoped, not per user. */
  signal: (week: number) => `week:${week}`,
}

export type { LineupWarehouseFacts, LineupSignalFacts }
