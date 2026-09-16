import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT } from '@/lib/events/catalog'
import type { DomainEvent } from '@/lib/events/types'

const enqueueLeagueEngineJob = vi.fn(async () => ({ ok: true, jobId: 'j1' }))
vi.mock('@/lib/jobs/enqueue', () => ({ enqueueLeagueEngineJob: (...a: unknown[]) => enqueueLeagueEngineJob(...a) }))
vi.mock('@/lib/sports-os/durableTier', () => ({ sportsDataCacheTier: () => null }))

const { createReactionConsumer, REACTION_CONSUMER_NAME } = await import('@/lib/sports-os/reactionConsumer')
const { __resetSummaryRegistryForTests, registerScreenSummary, readScreenSummary } = await import(
  '@/lib/sports-os/summaries'
)
const { __resetLayeredCacheForTests } = await import('@/lib/sports-os/layeredCache')
import type { RolloutRule } from '@/lib/sports-os/rollout'

const ON: Record<string, RolloutRule> = {
  'sports-os.reaction-invalidation': { enabled: true, percentage: 100 },
  'sports-os.ingest-reactions': { enabled: true, percentage: 100 },
}
const INVALIDATE_ONLY: Record<string, RolloutRule> = {
  'sports-os.reaction-invalidation': { enabled: true, percentage: 100 },
  'sports-os.ingest-reactions': { enabled: true, percentage: 0 },
}
const OFF: Record<string, RolloutRule> = {
  'sports-os.reaction-invalidation': { enabled: false, percentage: 0 },
  'sports-os.ingest-reactions': { enabled: false, percentage: 0 },
}

function event(over: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: 'evt_1',
    type: EVENT.INGEST_LEAGUE_COMPLETED,
    schemaVersion: 1,
    occurredAt: '2026-09-16T00:00:00.000Z',
    recordedAt: '2026-09-16T00:00:00.000Z',
    sport: 'NFL',
    leagueConcept: 'redraft',
    tenantId: 'allfantasy',
    leagueId: 'af-uuid-1',
    seasonId: 'se_1',
    actor: { type: 'system' },
    period: null,
    subjects: [],
    payload: { leagueId: 'af-uuid-1', provider: 'sleeper' },
    metadata: { source: 'ingestion:sleeper' },
    idempotencyKey: 'evt_1',
    ...over,
  } as DomainEvent
}

/** A screen keyed on a DIFFERENT id from the event's — the standings shape. */
function registerStandingsLike(resolver?: (e: { leagueId: string | null }) => string | null) {
  registerScreenSummary({
    screen: 'standings',
    version: 1,
    ttlMs: 600_000,
    build: async () => 'board',
    invalidatedBy: [EVENT.INGEST_LEAGUE_COMPLETED],
    ...(resolver ? { leagueKeyForEvent: resolver } : {}),
  })
}

describe('sports-os reaction consumer', () => {
  beforeEach(() => {
    __resetSummaryRegistryForTests()
    __resetLayeredCacheForTests()
    enqueueLeagueEngineJob.mockClear()
    enqueueLeagueEngineJob.mockResolvedValue({ ok: true, jobId: 'j1' })
  })

  it('resolves the screen’s OWN cache key, not the event’s league id', async () => {
    /*
     * 🛑 THE BUG THIS EXISTS TO CATCH. A DomainEvent carries canonical ids, so its leagueId is our
     * uuid — while the standings cache is keyed on the PROVIDER's id. Sweeping by the event's id
     * would build the wrong prefix, match nothing, and leave every board stale with nothing red.
     */
    registerStandingsLike(() => 'sleeper_999')
    await readScreenSummary('standings', { leagueId: 'sleeper_999', userId: 'u1', seasonId: '2026' })

    const onResult = vi.fn()
    await createReactionConsumer({ rules: ON, onResult }).handle(event())

    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ invalidated: ['standings'] }))
    // Evicted: the next read rebuilds.
    const after = await readScreenSummary('standings', { leagueId: 'sleeper_999', userId: 'u1', seasonId: '2026' })
    expect(after.source).toBe('live')
  })

  it('falls back to the event league id when a screen declares no resolver', async () => {
    registerStandingsLike()
    await readScreenSummary('standings', { leagueId: 'af-uuid-1', userId: 'u1' })

    await createReactionConsumer({ rules: ON }).handle(event())

    const after = await readScreenSummary('standings', { leagueId: 'af-uuid-1', userId: 'u1' })
    expect(after.source).toBe('live')
  })

  it('enqueues the declared job with the event-derived idempotency key', async () => {
    await createReactionConsumer({ rules: ON }).handle(event())

    expect(enqueueLeagueEngineJob).toHaveBeenCalledTimes(1)
    const [payload, opts] = enqueueLeagueEngineJob.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(payload).toMatchObject({ kind: 'standings_refresh', leagueId: 'af-uuid-1' })
    // BullMQ dedupes on jobId, so a redelivered event enqueues once rather than twice.
    expect(opts.jobId).toBe(payload.idempotencyKey)
    expect(String(payload.idempotencyKey)).toContain('evt_1')
  })

  it('gates the two halves independently', async () => {
    registerStandingsLike(() => 'sleeper_999')
    await readScreenSummary('standings', { leagueId: 'sleeper_999', userId: 'u1' })

    const onResult = vi.fn()
    await createReactionConsumer({ rules: INVALIDATE_ONLY, onResult }).handle(event())

    // Invalidation is a memory delete; enqueueing multiplies load on a single JS thread. One flag
    // covering both would price the cheap half at the expensive half's risk.
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ invalidated: ['standings'], enqueued: [] }))
    expect(enqueueLeagueEngineJob).not.toHaveBeenCalled()
  })

  it('does nothing at all when both flags are off', async () => {
    registerStandingsLike(() => 'sleeper_999')
    await readScreenSummary('standings', { leagueId: 'sleeper_999', userId: 'u1' })

    const onResult = vi.fn()
    await createReactionConsumer({ rules: OFF, onResult }).handle(event())

    expect(onResult).not.toHaveBeenCalled()
    expect(enqueueLeagueEngineJob).not.toHaveBeenCalled()
    const after = await readScreenSummary('standings', { leagueId: 'sleeper_999', userId: 'u1' })
    expect(after.source).toBe('cache')
  })

  it('NEVER throws, whatever fails underneath', async () => {
    /*
     * 🛑 THE RELAY DEAD-LETTERS AN EVENT WHOSE CONSUMER THROWS, taking the audit feed and the
     * intelligence snapshots down with it — they consume the same event. A reaction is a latency
     * optimisation and is not allowed to cost a fact.
     */
    registerScreenSummary({
      screen: 'standings',
      version: 1,
      ttlMs: 1,
      build: async () => 'x',
      invalidatedBy: [EVENT.INGEST_LEAGUE_COMPLETED],
      leagueKeyForEvent: () => {
        throw new Error('db down')
      },
    })
    enqueueLeagueEngineJob.mockRejectedValue(new Error('redis down'))

    await expect(createReactionConsumer({ rules: ON }).handle(event())).resolves.toBeUndefined()
  })

  it('NEVER throws from code OUTSIDE dispatchReactions either', async () => {
    /*
     * ⚠ THE TEST ABOVE DOES NOT REACH THE CONSUMER'S OWN try/catch, WHICH A MUTATION CONTROL
     * REVEALED. `leagueKeyForEvent` and `enqueue` are both invoked INSIDE `dispatchReactions`,
     * which already collects per-item failures — so removing the consumer's catch left that test
     * green. `onResult` is the call that sits outside it, and a caller's logger throwing must not
     * dead-letter a real domain event any more than a cache miss may.
     */
    registerStandingsLike(() => 'sleeper_999')
    const consumer = createReactionConsumer({
      rules: ON,
      onResult: () => {
        throw new Error('logger blew up')
      },
    })
    await expect(consumer.handle(event())).resolves.toBeUndefined()
  })

  it('buckets on the league, so one league is wholly in or out', async () => {
    // Per-user bucketing would give one league's members different behaviour for the same event,
    // which is neither a clean experiment nor a clean rollback.
    const partial: Record<string, RolloutRule> = {
      'sports-os.reaction-invalidation': { enabled: true, percentage: 50 },
      'sports-os.ingest-reactions': { enabled: true, percentage: 50 },
    }
    /*
     * ⚠ TWELVE EVENTS, NOT TWO. The first version of this test used two, which at 50% is a coin
     * flip that can land the same way by chance — and it did, so a mutation bucketing on `eventId`
     * instead of `leagueId` stayed GREEN. Twelve distinct events for one league make an
     * event-keyed bucket split with overwhelming probability, so all-or-nothing is a real
     * assertion rather than a lucky one.
     */
    const consumer = createReactionConsumer({ rules: partial })
    const before = enqueueLeagueEngineJob.mock.calls.length
    for (let i = 0; i < 12; i++) {
      await consumer.handle(event({ leagueId: 'lg-a', eventId: `evt_${i}` }))
    }
    const calls = enqueueLeagueEngineJob.mock.calls.length - before
    expect(calls === 0 || calls === 12).toBe(true)
  })

  it('names itself, so the relay can report which consumer acted', () => {
    expect(createReactionConsumer().name).toBe(REACTION_CONSUMER_NAME)
  })
})
