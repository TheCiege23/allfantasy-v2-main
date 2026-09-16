/**
 * Sports OS point 7, connected: the outbox relay's durable consumer that turns a delivered domain
 * event into the summary invalidations and jobs `./reactions.ts` declares.
 *
 * This is the piece that makes "an importer emits one event and knows nothing about what happens
 * next" true in production rather than on paper. It is registered alongside the audit-feed and
 * intelligence-snapshot consumers in `/api/cron/decision-os-activity-ingest`, which is the relay
 * that actually runs (see `cron-schedule.json`).
 *
 * 🛑 IT MUST NEVER THROW, AND THAT IS A HARDER RULE HERE THAN ANYWHERE ELSE IN THIS LAYER.
 *
 * The relay's contract is explicit: a consumer that throws fails the WHOLE event, which is then
 * retried with backoff and DEAD-LETTERED after `maxRetries`. So a cache invalidation that could not
 * reach Postgres, or a queue with no Redis behind it, would permanently destroy a real domain
 * event's delivery — the audit feed and the intelligence snapshots would lose it too, because they
 * are consumers of the same event. A reaction is a latency optimisation; it is not allowed to cost
 * a fact. Everything below is wrapped, including the rollout check and the key resolver.
 *
 * ⚠ THE TWO HALVES ARE GATED SEPARATELY. Invalidation is a memory delete plus a league-bounded
 * prefix delete whose worst case is one extra rebuild. Enqueueing multiplies load on a worker that
 * is one JavaScript thread. See the note in `./rollout.ts`.
 *
 * ⚠ THE BUCKET SUBJECT IS THE LEAGUE, NOT THE USER. A reaction is league-shaped work — every member
 * of a league shares one cached board — so bucketing per user would give one league's members
 * different behaviour for the same event, which is neither a clean experiment nor a clean rollback.
 */

import 'server-only'

import type { DomainEvent, EventConsumer } from '@/lib/events/types'
import { enqueueLeagueEngineJob } from '@/lib/jobs/enqueue'
import { dispatchReactions, type ReactionEnqueue, type ReactionJob, type DispatchResult } from './reactions'
import { getScreenSummaryDefinition, invalidateScreenForLeague } from './summaries'
import { sportsDataCacheTier } from './durableTier'
import { isEnabled, DEFAULT_ROLLOUTS, type RolloutRule } from './rollout'

export const REACTION_CONSUMER_NAME = 'sports-os.reactions'

/**
 * Queue name to enqueue function.
 *
 * ⚠ A `Record` OVER THE UNION ON PURPOSE. Widening `ReactionJob['queue']` without adding a mapping
 * here is a compile error, which is the point: a queue with no mapping would silently drop its jobs.
 */
const ENQUEUE_BY_QUEUE: Record<ReactionJob['queue'], ReactionEnqueue> = {
  league_engine: async (job) =>
    enqueueLeagueEngineJob(
      { kind: job.kind, leagueId: job.leagueId ?? undefined, idempotencyKey: job.idempotencyKey, payload: job.payload },
      // BullMQ dedupes on jobId, so a redelivered event enqueues once rather than twice.
      { jobId: job.idempotencyKey },
    ),
}

const realEnqueue: ReactionEnqueue = (job) => ENQUEUE_BY_QUEUE[job.queue](job)

export type ReactionConsumerOptions = {
  /** Injected for tests. Defaults to the real BullMQ enqueue. */
  enqueue?: ReactionEnqueue
  /** Injected for tests. Defaults to the shared `SportsDataCache` tier. */
  durable?: Parameters<typeof invalidateScreenForLeague>[2]
  rules?: Readonly<Record<string, RolloutRule>>
  onResult?: (result: DispatchResult & { leagueId: string | null }) => void
}

/**
 * The league key a screen's cache is scoped by, for this event.
 *
 * Falls back to the event's own `leagueId` when the screen declares no resolver — correct for a
 * screen keyed on our canonical id, and wrong only for one that is not, which is exactly why
 * `leagueKeyForEvent` exists.
 */
async function leagueKeyFor(screen: string, event: DomainEvent): Promise<string | null> {
  const definition = getScreenSummaryDefinition(screen)
  if (!definition?.leagueKeyForEvent) return event.leagueId
  return (await definition.leagueKeyForEvent({ leagueId: event.leagueId })) ?? null
}

export function createReactionConsumer(options: ReactionConsumerOptions = {}): EventConsumer {
  const rules = options.rules ?? DEFAULT_ROLLOUTS
  const enqueue = options.enqueue ?? realEnqueue
  const durable = options.durable === undefined ? sportsDataCacheTier() : options.durable

  return {
    name: REACTION_CONSUMER_NAME,
    async handle(event: DomainEvent): Promise<void> {
      try {
        // League-shaped work with no league is not addressable by any reaction in the table.
        const leagueId = event.leagueId
        const invalidationOn = isEnabled('sports-os.reaction-invalidation', leagueId, rules)
        const jobsOn = isEnabled('sports-os.ingest-reactions', leagueId, rules)
        if (!invalidationOn && !jobsOn) return

        const result = await dispatchReactions(event, {
          invalidate: invalidationOn
            ? async (screen) => {
                const key = await leagueKeyFor(screen, event)
                if (key) await invalidateScreenForLeague(screen, key, durable)
              }
            : null,
          enqueue: jobsOn ? enqueue : null,
        })
        options.onResult?.({ ...result, leagueId })
      } catch {
        /*
         * 🛑 SWALLOWED DELIBERATELY — see the header. Rethrowing here would dead-letter a real
         * domain event over a cache miss, taking the audit feed and the intelligence snapshots
         * down with it. `dispatchReactions` already collects per-item failures in its result; this
         * is the backstop for anything outside it (the rollout read, the key resolver).
         */
      }
    },
  }
}
