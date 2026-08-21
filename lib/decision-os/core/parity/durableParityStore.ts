import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import type { DecisionTelemetryEvent, DecisionTelemetryEventName } from '../telemetry'
import type { DecisionTelemetryDebugEvent } from '../telemetryDebugStore'

type PrismaLike = typeof defaultPrisma

/**
 * Durable storage for parity telemetry — the evidence the shadow-mode flip gate is defined on.
 *
 * `summarizeFlipReadiness` decides a surface is ready when agreement holds at >=95% over >=50 REAL
 * comparisons. It reads `telemetryDebugStore`, an in-memory array capped at 500 entries that starts
 * empty on every cold start, so the gate can never accumulate the 50 it requires. This is where the
 * evidence goes instead.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS CALLED DIRECTLY AND NOT REGISTERED AS A TELEMETRY SINK
 *
 * The first version of this registered a `DecisionTelemetrySink` from `instrumentation.ts` at boot.
 * It was verified in production and it does not work: `[ProviderConfig]` proves `register()` runs on
 * every cold start, yet the cron route's `emitDecisionTelemetry` still took its `console.log`
 * fallback, which only happens when `sink` is null. Next.js bundles `instrumentation.ts` separately
 * from route handlers, so the module-level `sink` in `core/telemetry.ts` was set on the
 * instrumentation bundle's copy of that module while the route imported a different instance.
 * Module state does not cross bundles.
 *
 * Registering a sink was also actively harmful: `emitDecisionTelemetry` is
 * `if (sink) sink(p) else console.log(p)`, so a sink that only handles parity silently DELETED
 * `decision.issued` / `adopted` / `resolved` / `live_enrichment` from the production log drain.
 *
 * Calling from `core/parity/telemetry.ts` — the module every parity emitter already goes through —
 * puts the write in the same module graph as the emitter, so there is no registration to lose, and
 * leaves the console.log path intact for everything else.
 *
 * ⚠ ONLY PARITY EVENTS ARE STORED. The rest are high-frequency and irrelevant to the flip decision;
 * persisting them would be write amplification with no consumer.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
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
 * silently as agreement. If these two diverge, the persisted gate and the in-memory gate would
 * disagree about the same events, which is worse than either being wrong alone.
 */
export function agreementOf(flags: Record<string, unknown> | undefined | null): boolean | null {
  if (!flags) return null
  if (typeof flags.agreement === 'boolean') return flags.agreement
  if (typeof flags.sameTopPlayer === 'boolean') return flags.sameTopPlayer
  // `parity_passed` is the cross-slice parity verdict -- lineup, waiver, both trade paths and
  // commissioner-health all emit it, and it is the ONLY agreement signal any of them emit. Without
  // this branch every one of those comparisons is counted as a comparison WITHOUT a verdict, so
  // `agreementRate` stays null no matter how many accumulate and no surface can ever reach `ready`.
  // Confirmed against production: 8 stored lineup comparisons, all verdictless, flags carrying
  // `parity_passed` and nothing this function read.
  //
  // Checked LAST so it cannot change the meaning of an event that already carries an explicit
  // `agreement` (the trade surfaces set that deliberately).
  //
  // `sameTopPlayer` is kept above despite NO slice emitting it -- removing dead vocabulary is a
  // separate change from fixing a gate, and dropping it here would silently alter any historical
  // event that happens to carry it.
  if (typeof flags.parity_passed === 'boolean') return flags.parity_passed
  return null
}

function str(v: unknown, max = 64): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

/**
 * In-flight writes, so a serverless handler can flush before it returns.
 *
 * On Vercel the instance can be frozen the moment the response is sent, which kills any promise
 * that has not settled. A fire-and-forget write is therefore not "eventually consistent" here — it
 * is simply lost. `awaitPendingParityWrites()` exists so a cron, which has no latency budget to
 * protect, can wait; request paths can skip it and accept the loss.
 */
const pending = new Set<Promise<unknown>>()

/**
 * Persist one parity event. Never throws, never returns a promise the caller must handle.
 *
 * The emitters are synchronous and sit inside decision paths, so this cannot await: database
 * latency must not be added to every decision. The promise is tracked instead, so callers that
 * CAN wait are able to.
 */
export function persistParityEvent(
  event: DecisionTelemetryEvent,
  db: PrismaLike = defaultPrisma,
): void {
  try {
    if (!isParityEvent(event.event)) return
    const flags = (event.flags ?? {}) as Record<string, unknown>
    // Absent until the migration is applied. Reaching for `.create` on undefined would throw
    // SYNCHRONOUSLY, before any `.catch` could attach — putting a telemetry failure inside a
    // decision path, the one thing this must never do.
    const delegate = (db as unknown as {
      decisionParityRecord?: { create(args: unknown): Promise<unknown> }
    }).decisionParityRecord
    if (!delegate) return

    const p = delegate
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
      .finally(() => {
        pending.delete(p)
      })
    pending.add(p)
  } catch {
    // Telemetry must never break, delay, or fail a decision.
  }
}

/**
 * Wait for outstanding parity writes. Returns how many were awaited.
 *
 * Bounded by `timeoutMs` so a slow or unreachable database cannot hold a cron open until its
 * platform duration kill — which would run no user code at all and lose the work anyway.
 */
export async function awaitPendingParityWrites(timeoutMs = 5_000): Promise<number> {
  const inFlight = [...pending]
  if (inFlight.length === 0) return 0
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.allSettled(inFlight),
      new Promise((resolve) => {
        timer = setTimeout(resolve, Math.max(0, timeoutMs))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
  return inFlight.length
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
