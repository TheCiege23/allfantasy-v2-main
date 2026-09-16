/**
 * Sports OS — point 7: one event system. An import triggers the projections, rankings, alerts and
 * OS recommendations it affects, instead of each of them polling or each import path remembering to
 * call them.
 *
 * The rule: **an ingestion path emits ONE event and knows nothing about what happens next.** This
 * file is the single table that says what an event makes wrong (summaries to drop) and what it
 * makes due (jobs to enqueue). Adding a consumer means adding a row here, never editing the
 * importer.
 *
 * ⚠ THE PLAN IS PURE; THE DISPATCH IS INJECTED. `planReactions` is a pure function of an event, so
 * "what does a Sleeper import kick off" is answerable in a unit test with no queue, no Redis and no
 * database. `dispatchReactions` takes its enqueue function as an argument for the same reason —
 * `lib/jobs/enqueue.ts` is `server-only` and importing it here would put a Redis client in the type
 * graph of anything that wants to ask the question.
 *
 * 🛑 FAN-OUT IS THE EXPENSIVE DIRECTION, AND THE WORKER IS ONE JAVASCRIPT THREAD. CLAUDE.md records
 * 48 sub-second cron runs taking 65–350s because the worker's single thread was loaded, not pegged.
 * Enqueueing five jobs per import is a straightforward way to reproduce that, which is why
 * `sports-os.ingest-reactions` starts at 0% in `./rollout.ts` and why every plan here is capped.
 */

import { EVENT } from '@/lib/events/catalog'
import type { DomainEvent } from '@/lib/events/types'
import { screensInvalidatedBy } from './summaries'

/** A job this event makes due. Queue names match `QUEUE_NAMES` in `lib/jobs/types.ts`. */
export type ReactionJob = {
  queue: 'league_engine' | 'ai' | 'notifications' | 'devy' | 'simulations'
  kind: string
  leagueId?: string | null
  payload?: Record<string, unknown>
  /**
   * Makes a repeat enqueue a no-op. At-least-once delivery is the outbox's contract, so a reaction
   * WILL be planned twice for the same event; without this that is two rebuilds of one summary.
   */
  idempotencyKey: string
}

export type ReactionPlan = {
  eventType: string
  /** Screens whose precomputed summary this event invalidates. */
  invalidateScreens: string[]
  jobs: ReactionJob[]
}

/**
 * Static rows: which job kinds each event type triggers.
 *
 * ⚠ KEEP THIS SMALL AND SAY WHY EACH ROW EARNS ITS PLACE. Every entry is worker load on every
 * occurrence of its event, and `ingest.scores.refreshed` fires on a live-scoring cadence.
 */
const JOB_ROWS: Record<string, ReadonlyArray<Pick<ReactionJob, 'queue' | 'kind'>>> = {
  // A finished import is the one moment we KNOW a league's whole shape changed.
  [EVENT.INGEST_LEAGUE_COMPLETED]: [
    { queue: 'league_engine', kind: 'standings_refresh' },
    { queue: 'ai', kind: 'digest' },
  ],
  // Rosters moved: standings are unaffected, but anything roster-shaped is stale.
  [EVENT.INGEST_ROSTERS_REFRESHED]: [{ queue: 'league_engine', kind: 'standings_refresh' }],
  // Scores move on a live cadence. Summary invalidation only — NO job. Enqueueing per score tick is
  // how one JS thread ends up with a 350s queue behind a sub-second job.
  [EVENT.INGEST_SCORES_REFRESHED]: [],
  [EVENT.INGEST_PROJECTIONS_REFRESHED]: [],
  [EVENT.INGEST_PLAYER_VALUES_REFRESHED]: [],
  // A processed trade or waiver changes standings AND is worth telling people about.
  [EVENT.TRADE_PROCESSED]: [
    { queue: 'league_engine', kind: 'standings_refresh' },
    { queue: 'notifications', kind: 'dispatch' },
  ],
  [EVENT.WAIVER_WINDOW_PROCESSED]: [
    { queue: 'league_engine', kind: 'standings_refresh' },
    { queue: 'notifications', kind: 'dispatch' },
  ],
  [EVENT.MATCHUP_FINALIZED]: [{ queue: 'league_engine', kind: 'standings_refresh' }],
  [EVENT.DRAFT_COMPLETED]: [
    { queue: 'league_engine', kind: 'standings_refresh' },
    { queue: 'ai', kind: 'digest' },
  ],
}

/** At most this many jobs from one event, whatever the table says. A cap you never hit costs nothing. */
export const MAX_JOBS_PER_EVENT = 4

/**
 * The envelope's own `leagueId` first, then the payload, then a `league` subject.
 *
 * ⚠ THE ENVELOPE FIELD IS THE AUTHORITY AND THE PAYLOAD IS THE FALLBACK, not the other way round.
 * `DomainEvent.leagueId` is set by the normalizer for every event; a `leagueId` inside `payload` is
 * whatever the producer happened to pass, and the two can disagree.
 */
function leagueIdOf(event: DomainEvent): string | null {
  if (typeof event.leagueId === 'string' && event.leagueId) return event.leagueId
  const payload = (event.payload ?? {}) as Record<string, unknown>
  if (typeof payload.leagueId === 'string' && payload.leagueId) return payload.leagueId
  return event.subjects?.find((subject) => subject.kind === 'league')?.id ?? null
}

/**
 * What this event makes wrong and what it makes due. Pure — no queue, no cache, no clock.
 *
 * The idempotency key is built from `eventId` — the envelope's own idempotency anchor for consumers
 * — not from the league and job kind. Two different imports of one league are two real rebuilds;
 * the same event delivered twice is one.
 */
export function planReactions(event: DomainEvent): ReactionPlan {
  const leagueId = leagueIdOf(event)
  const rows = JOB_ROWS[event.type] ?? []
  const jobs: ReactionJob[] = rows.slice(0, MAX_JOBS_PER_EVENT).map((row) => ({
    queue: row.queue,
    kind: row.kind,
    leagueId,
    payload: { eventType: event.type, ...(leagueId ? { leagueId } : {}) },
    idempotencyKey: `sos:${event.eventId}:${row.queue}:${row.kind}`,
  }))
  return {
    eventType: event.type,
    invalidateScreens: screensInvalidatedBy(event.type),
    jobs,
  }
}

export type ReactionEnqueue = (job: ReactionJob) => Promise<{ ok: boolean; error?: string }>
export type ReactionInvalidate = (screen: string, event: DomainEvent) => void | Promise<void>

export type DispatchResult = {
  eventType: string
  invalidated: string[]
  enqueued: string[]
  failed: Array<{ kind: string; error: string }>
}

/**
 * Carry out a plan.
 *
 * ⚠ INVALIDATION HAPPENS FIRST AND IS NEVER SKIPPED BECAUSE AN ENQUEUE FAILED. Dropping a stale
 * summary costs one rebuild on the next read; leaving it costs a wrong screen. If Redis is down,
 * the rebuild simply happens on read — which is exactly the property `./summaries.ts` is built for.
 *
 * ⚠ AND IT NEVER THROWS. This runs from an event consumer whose contract is at-least-once delivery;
 * a reaction that rejects would re-deliver the event and re-run the reactions that already
 * succeeded. Failures come back in the result instead.
 */
export async function dispatchReactions(
  event: DomainEvent,
  handlers: { enqueue?: ReactionEnqueue | null; invalidate?: ReactionInvalidate | null },
): Promise<DispatchResult> {
  const plan = planReactions(event)
  const result: DispatchResult = { eventType: plan.eventType, invalidated: [], enqueued: [], failed: [] }

  for (const screen of plan.invalidateScreens) {
    try {
      await handlers.invalidate?.(screen, event)
      result.invalidated.push(screen)
    } catch (error) {
      result.failed.push({ kind: `invalidate:${screen}`, error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (!handlers.enqueue) return result

  for (const job of plan.jobs) {
    try {
      const outcome = await handlers.enqueue(job)
      if (outcome.ok) result.enqueued.push(job.idempotencyKey)
      else result.failed.push({ kind: `${job.queue}:${job.kind}`, error: outcome.error ?? 'enqueue failed' })
    } catch (error) {
      result.failed.push({ kind: `${job.queue}:${job.kind}`, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return result
}

/** Every event type with a reaction row, for a docs page or an admin panel. */
export function reactingEventTypes(): string[] {
  return Object.keys(JOB_ROWS).sort()
}
