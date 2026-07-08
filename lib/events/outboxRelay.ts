/**
 * G15.1/G15.3 — Outbox Relay: drains pending outbox rows and delivers each event
 * to durable consumers (at-least-once), with retry/backoff and dead-lettering.
 *
 * Delivery model:
 *   • CONSUMERS (durable): every consumer must process the event; a thrown error
 *     fails the whole event → retry (capped exponential backoff) → dead-letter
 *     after `maxRetries`. Consumers MUST be idempotent (keyed on `eventId`).
 *   • BUS (optional, best-effort fan-out): published after consumers succeed, for
 *     ephemeral real-time subscribers (e.g. SSE). A bus failure never fails the event.
 *
 * Horizontal safety: a single relay instance is safe. For multi-node, `claimPending`
 * must atomically claim rows (e.g. Postgres `SELECT … FOR UPDATE SKIP LOCKED` or a
 * `status='claimed'` CAS) so two relays never dispatch the same row — see the runbook
 * in docs/g15-3-relay-and-projection.md. The default in-process bus is single-node.
 */
import { randomUUID } from 'node:crypto'
import type { DomainEvent, EventConsumer, IEventBus, IOutboxStore } from './types'

export type RelayLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type RelayLogger = (level: RelayLogLevel, message: string, meta?: Record<string, unknown>) => void

export interface OutboxRelayOptions {
  /** Durable consumers with delivery guarantees (retry/dead-letter). */
  consumers?: EventConsumer[]
  /** Optional best-effort real-time fan-out (never fails an event). */
  bus?: IEventBus
  batchSize?: number
  /** Dead-letter once an event has failed this many attempts. */
  maxRetries?: number
  baseRetryMs?: number
  maxRetryMs?: number
  /** When true: report what would be dispatched without delivering or mutating state. */
  dryRun?: boolean
  /** Identifies this worker on claimed rows (for ownership + debugging). Default: random. */
  workerId?: string
  /** A claim older than this is considered stale (crashed worker) and reclaimable. Default 60s. */
  claimTimeoutMs?: number
  logger?: RelayLogger
  now?: () => Date
}

export interface DispatchSummary {
  fetched: number
  dispatched: number
  retried: number
  deadLettered: number
  /** retried + deadLettered (kept for back-compat). */
  failed: number
  dryRun: boolean
  failures: { eventId: string; error: string }[]
}

export interface RunOptions {
  /** Max batches to process (default: drain fully). */
  maxBatches?: number
  /** Sleep between non-empty batches (ms). Default 0. */
  intervalMs?: number
  /** Stop once a batch comes back empty (default true). */
  stopWhenEmpty?: boolean
  /** Cooperative stop signal checked before each batch. */
  shouldStop?: () => boolean
}

const noopLogger: RelayLogger = () => {}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class OutboxRelay {
  private readonly consumers: EventConsumer[]
  private readonly bus?: IEventBus
  private readonly batchSize: number
  private readonly maxRetries: number
  private readonly baseRetryMs: number
  private readonly maxRetryMs: number
  private readonly dryRun: boolean
  private readonly workerId: string
  private readonly claimTimeoutMs: number
  private readonly logger: RelayLogger
  private readonly now: () => Date

  constructor(
    private readonly store: IOutboxStore,
    opts: OutboxRelayOptions = {},
  ) {
    this.consumers = opts.consumers ?? []
    this.bus = opts.bus
    this.batchSize = opts.batchSize ?? 100
    this.maxRetries = opts.maxRetries ?? 5
    this.baseRetryMs = opts.baseRetryMs ?? 5_000
    this.maxRetryMs = opts.maxRetryMs ?? 5 * 60_000
    this.dryRun = opts.dryRun ?? false
    this.workerId = opts.workerId ?? `relay-${randomUUID().slice(0, 8)}`
    this.claimTimeoutMs = opts.claimTimeoutMs ?? 60_000
    this.logger = opts.logger ?? noopLogger
    this.now = opts.now ?? (() => new Date())
  }

  /** This relay's worker id (stamped on claimed rows). */
  get id(): string {
    return this.workerId
  }

  private backoffMs(attempts: number): number {
    return Math.min(this.baseRetryMs * 2 ** Math.max(0, attempts - 1), this.maxRetryMs)
  }

  /** Process exactly one batch. Never throws for a single bad event. */
  async runOnce(): Promise<DispatchSummary> {
    const now = this.now()
    // Dry-run: read-only peek (no claim, no state change). Otherwise atomically claim.
    const items = this.dryRun
      ? await this.store.claimPending(this.batchSize, now)
      : await this.store.claimBatch(this.workerId, { batchSize: this.batchSize, staleClaimMs: this.claimTimeoutMs, now })

    const summary: DispatchSummary = {
      fetched: items.length,
      dispatched: 0,
      retried: 0,
      deadLettered: 0,
      failed: 0,
      dryRun: this.dryRun,
      failures: [],
    }

    for (const { event, attempts } of items) {
      if (this.dryRun) {
        this.logger('info', 'relay dry-run: would dispatch', { workerId: this.workerId, eventId: event.eventId, type: event.type, attempts })
        continue
      }
      try {
        for (const consumer of this.consumers) {
          await consumer.handle(event)
        }
        if (this.bus) {
          try {
            await this.bus.publish(event)
          } catch (busErr) {
            this.logger('warn', 'relay bus fan-out failed (non-fatal)', {
              workerId: this.workerId,
              eventId: event.eventId,
              error: busErr instanceof Error ? busErr.message : String(busErr),
            })
          }
        }
        await this.store.markDispatched(event.eventId)
        summary.dispatched += 1
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        const nextAttempts = attempts + 1
        if (nextAttempts >= this.maxRetries) {
          await this.store.markDead(event.eventId, error)
          summary.deadLettered += 1
          this.logger('error', 'relay dead-lettered event', { workerId: this.workerId, eventId: event.eventId, type: event.type, attempts: nextAttempts, error })
        } else {
          const nextAvailableAt = new Date(now.getTime() + this.backoffMs(nextAttempts))
          await this.store.markRetry(event.eventId, error, nextAvailableAt)
          summary.retried += 1
          this.logger('warn', 'relay retry scheduled', { workerId: this.workerId, eventId: event.eventId, attempts: nextAttempts, nextAvailableAt, error })
        }
        summary.failures.push({ eventId: event.eventId, error })
      }
    }

    summary.failed = summary.retried + summary.deadLettered
    this.logger('info', 'relay batch complete', {
      workerId: this.workerId,
      fetched: summary.fetched,
      dispatched: summary.dispatched,
      retried: summary.retried,
      deadLettered: summary.deadLettered,
      dryRun: summary.dryRun,
    })
    return summary
  }

  /** Back-compat alias for a single batch. */
  async dispatchPending(): Promise<DispatchSummary> {
    return this.runOnce()
  }

  /** Drain in a loop until empty (or maxBatches / shouldStop). Dry-run does a single batch. */
  async run(opts: RunOptions = {}): Promise<DispatchSummary> {
    const maxBatches = this.dryRun ? 1 : opts.maxBatches ?? Number.POSITIVE_INFINITY
    const stopWhenEmpty = opts.stopWhenEmpty ?? true
    const agg: DispatchSummary = { fetched: 0, dispatched: 0, retried: 0, deadLettered: 0, failed: 0, dryRun: this.dryRun, failures: [] }

    let batches = 0
    while (batches < maxBatches) {
      if (opts.shouldStop?.()) break
      const s = await this.runOnce()
      agg.fetched += s.fetched
      agg.dispatched += s.dispatched
      agg.retried += s.retried
      agg.deadLettered += s.deadLettered
      agg.failures.push(...s.failures)
      batches += 1
      if (s.fetched === 0 && stopWhenEmpty) break
      if (opts.intervalMs && s.fetched > 0) await sleep(opts.intervalMs)
    }

    agg.failed = agg.retried + agg.deadLettered
    return agg
  }
}
