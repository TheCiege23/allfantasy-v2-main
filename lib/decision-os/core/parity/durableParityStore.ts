import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import type { DecisionTelemetryEvent, DecisionTelemetryEventName, DecisionTelemetrySink } from '../telemetry'
import type { DecisionTelemetryDebugEvent } from '../telemetryDebugStore'

type PrismaLike = typeof defaultPrisma

/**
 * Durable storage for parity telemetry — the missing half of the flip gate.
 *
 * `summarizeFlipReadiness` decides a surface is ready when agreement holds at >=95% over >=50 REAL
 * comparisons. It reads `telemetryDebugStore`, which is an in-memory array capped at 500 entries:
 *
 *     const events: DecisionTelemetryDebugEvent[] = []
 *
 * On Vercel every invocation has its own memory. The array starts empty on each cold start and is
 * never shared between instances, so the gate can never accumulate the 50 comparisons it requires.
 * Meanwhile `emitDecisionTelemetry` falls through to `console.log`, sending the evidence to the log
 * drain where nothing can query it. Parity data has been generated and discarded this whole time,
 * which is why no surface has ever flipped.
 *
 * This persists it so the gate can finally be evaluated against real history.
 *
 * ⚠ ONLY PARITY EVENTS ARE STORED. `decision.issued`, `decision.live_enrichment` and the rest are
 * high-frequency and irrelevant to the flip decision; persisting them would be a write amplification
 * with no consumer.
 */

/** The two events the flip gate is defined on. */
const PARITY_EVENTS = new Set(['decision.shadow_parity', 'decision.validator_parity'])

export function isParityEvent(event: string): boolean {
  return PARITY_EVENTS.has(event)
}

/**
 * The agreement verdict, extracted to a column so the gate can be computed in SQL instead of by
 * parsing JSON for every row.
 *
 * Mirrors `flipReadiness.agreementSignal` EXACTLY, including its most important property: an event
 * with neither signal returns null and is counted as a comparison WITHOUT a verdict — never
 * silently as agreement. If these two ever diverge, the persisted gate and the in-memory gate would
 * disagree about the same events, which is worse than either being wrong alone.
 */
export function agreementOf(flags: Record<string, unknown> | undefined | null): boolean | null {
  if (!flags) return null
  if (typeof flags.agreement === 'boolean') return flags.agreement
  if (typeof flags.sameTopPlayer === 'boolean') return flags.sameTopPlayer
  return null
}

function str(v: unknown, max = 64): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

/**
 * A telemetry sink that persists parity events.
 *
 * FIRE AND FORGET, BY NECESSITY. `emitDecisionTelemetry` is synchronous and is called from inside
 * decision paths; awaiting a write there would put database latency on every decision. The promise
 * is deliberately not awaited and its rejection is swallowed — telemetry must never break, delay,
 * or fail a decision. The cost is that a write lost to a crash is simply lost, which is acceptable
 * for evidence that is aggregated over dozens of comparisons.
 */
export function createDurableParitySink(db: PrismaLike = defaultPrisma): DecisionTelemetrySink {
  return (event: DecisionTelemetryEvent) => {
    if (!isParityEvent(event.event)) return
    const flags = (event.flags ?? {}) as Record<string, unknown>
    // The delegate is absent until the migration is applied. Reaching for `.create` on undefined
    // would throw SYNCHRONOUSLY, before any `.catch` could attach — which would put a telemetry
    // failure inside a decision path, the one thing this must never do.
    const delegate = (db as unknown as {
      decisionParityRecord?: { create(args: unknown): Promise<unknown> }
    }).decisionParityRecord
    if (!delegate) return
    void delegate
      .create({
        data: {
          event: event.event.slice(0, 64),
          decisionType: String(event.decision_type ?? '').slice(0, 64),
          surface: str(flags.surface),
          decisionId: str(event.decision_id),
          leagueId: str(flags.leagueId),
          userId: str(flags.userId),
          agreement: agreementOf(flags),
          flags: event.flags ?? undefined,
        },
      })
      .catch(() => {})
  }
}

export type PersistedParityFilters = {
  decisionType?: string | null
  since?: Date | null
  limit?: number | null
}

/**
 * Read persisted parity events back in the shape `summarizeFlipReadiness` already consumes, so the
 * aggregation logic and its gate stay in one place rather than being reimplemented in SQL.
 */
export async function listPersistedParityEvents(
  db: PrismaLike = defaultPrisma,
  filters: PersistedParityFilters = {},
): Promise<DecisionTelemetryDebugEvent[]> {
  const delegate = (db as unknown as {
    decisionParityRecord?: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> }
  }).decisionParityRecord
  // Honest refusal: before the migration is applied this delegate does not exist, and the caller
  // must fall back rather than crash an admin surface.
  if (!delegate) return []

  const rows = await delegate
    .findMany({
      where: {
        ...(filters.decisionType ? { decisionType: filters.decisionType } : {}),
        ...(filters.since ? { recordedAt: { gte: filters.since } } : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: Math.min(Math.max(filters.limit ?? 5000, 1), 20000),
    })
    .catch(() => [] as Array<Record<string, unknown>>)

  return rows.map((r) => ({
    // Only the two parity names are ever written (see `isParityEvent`), so this narrowing is
    // sound for every row this table can contain.
    event: String(r.event) as DecisionTelemetryEventName,
    decision_type: String(r.decisionType),
    decision_id: (r.decisionId as string | null) ?? undefined,
    flags: (r.flags ?? undefined) as DecisionTelemetryEvent['flags'],
    at: (r.recordedAt as Date | undefined)?.toISOString() ?? new Date(0).toISOString(),
    userId: (r.userId as string | null) ?? null,
    leagueId: (r.leagueId as string | null) ?? null,
  }))
}
