import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT } from '@/lib/events/catalog'
import type { DomainEvent } from '@/lib/events/types'
import { MAX_JOBS_PER_EVENT, dispatchReactions, planReactions, reactingEventTypes } from '@/lib/sports-os/reactions'
import { __resetSummaryRegistryForTests, registerScreenSummary } from '@/lib/sports-os/summaries'

function event(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: 'evt_1',
    type: EVENT.INGEST_LEAGUE_COMPLETED,
    schemaVersion: 1,
    occurredAt: '2026-09-16T00:00:00.000Z',
    recordedAt: '2026-09-16T00:00:00.000Z',
    sport: 'NFL',
    leagueConcept: 'redraft',
    tenantId: 'allfantasy',
    leagueId: 'lg_1',
    seasonId: 'se_1',
    actor: { type: 'system' },
    period: null,
    subjects: [],
    payload: { leagueId: 'lg_1', provider: 'sleeper' },
    metadata: { source: 'ingestion:sleeper' },
    idempotencyKey: 'evt_1',
    ...overrides,
  } as DomainEvent
}

describe('sports-os reactions', () => {
  beforeEach(() => {
    __resetSummaryRegistryForTests()
  })

  it('fans a finished import out to jobs', () => {
    const plan = planReactions(event())
    expect(plan.jobs.map((j) => `${j.queue}:${j.kind}`)).toEqual(['league_engine:standings_refresh', 'ai:digest'])
    expect(plan.jobs.every((j) => j.leagueId === 'lg_1')).toBe(true)
  })

  it('plans no job for a live-cadence event', () => {
    // Enqueueing per score tick is how one JS thread ends up with a 350s queue behind a
    // sub-second job (CLAUDE.md records exactly that).
    expect(planReactions(event({ type: EVENT.INGEST_SCORES_REFRESHED })).jobs).toEqual([])
  })

  it('returns an empty plan for an event nobody reacts to', () => {
    const plan = planReactions(event({ type: EVENT.CHAT_MESSAGE_POSTED }))
    expect(plan.jobs).toEqual([])
    expect(plan.invalidateScreens).toEqual([])
  })

  it('keys idempotency on eventId, so a redelivery is one job and two imports are two', () => {
    // At-least-once delivery is the outbox contract: the same event WILL arrive twice.
    const first = planReactions(event({ eventId: 'evt_a' }))
    const redelivered = planReactions(event({ eventId: 'evt_a' }))
    const secondImport = planReactions(event({ eventId: 'evt_b' }))

    expect(first.jobs[0].idempotencyKey).toBe(redelivered.jobs[0].idempotencyKey)
    expect(first.jobs[0].idempotencyKey).not.toBe(secondImport.jobs[0].idempotencyKey)
  })

  it('prefers the envelope leagueId over the payload, then falls back to a subject', () => {
    // The normalizer sets the envelope field for every event; a payload leagueId is whatever the
    // producer happened to pass, and the two can disagree.
    const conflicting = planReactions(event({ leagueId: 'lg_envelope', payload: { leagueId: 'lg_payload' } }))
    expect(conflicting.jobs[0].leagueId).toBe('lg_envelope')

    const fromPayload = planReactions(event({ leagueId: null, payload: { leagueId: 'lg_payload' } }))
    expect(fromPayload.jobs[0].leagueId).toBe('lg_payload')

    const fromSubject = planReactions(
      event({ leagueId: null, payload: {}, subjects: [{ kind: 'league', id: 'lg_subject' }] }),
    )
    expect(fromSubject.jobs[0].leagueId).toBe('lg_subject')

    const none = planReactions(event({ leagueId: null, payload: {}, subjects: [] }))
    expect(none.jobs[0].leagueId).toBeNull()
  })

  it('never plans more than the cap', () => {
    for (const type of reactingEventTypes()) {
      expect(planReactions(event({ type })).jobs.length, type).toBeLessThanOrEqual(MAX_JOBS_PER_EVENT)
    }
  })

  it('names the summaries an event invalidates', () => {
    registerScreenSummary({
      screen: 'standings',
      version: 1,
      ttlMs: 60_000,
      build: async () => ({}),
      invalidatedBy: [EVENT.INGEST_LEAGUE_COMPLETED, EVENT.MATCHUP_FINALIZED],
    })
    registerScreenSummary({
      screen: 'portfolio',
      version: 1,
      ttlMs: 60_000,
      build: async () => ({}),
      invalidatedBy: [EVENT.INGEST_PLAYER_VALUES_REFRESHED],
    })

    expect(planReactions(event()).invalidateScreens).toEqual(['standings'])
    expect(planReactions(event({ type: EVENT.INGEST_PLAYER_VALUES_REFRESHED })).invalidateScreens).toEqual(['portfolio'])
  })

  it('invalidates even when every enqueue fails', async () => {
    // A stale summary costs a wrong screen; a missed job costs a rebuild on the next read. If Redis
    // is down, invalidation must still happen.
    registerScreenSummary({
      screen: 'standings',
      version: 1,
      ttlMs: 60_000,
      build: async () => ({}),
      invalidatedBy: [EVENT.INGEST_LEAGUE_COMPLETED],
    })
    const invalidateFn = vi.fn()
    const result = await dispatchReactions(event(), {
      invalidate: invalidateFn,
      enqueue: async () => ({ ok: false, error: 'Notifications queue not configured (Redis required).' }),
    })

    expect(invalidateFn).toHaveBeenCalledWith('standings', expect.objectContaining({ eventId: 'evt_1' }))
    expect(result.invalidated).toEqual(['standings'])
    expect(result.enqueued).toEqual([])
    expect(result.failed).toHaveLength(2)
  })

  it('never throws, even when both handlers reject', async () => {
    // A reaction that rejects re-delivers the event and re-runs the reactions that already worked.
    registerScreenSummary({
      screen: 'standings',
      version: 1,
      ttlMs: 60_000,
      build: async () => ({}),
      invalidatedBy: [EVENT.INGEST_LEAGUE_COMPLETED],
    })
    const result = await dispatchReactions(event(), {
      invalidate: () => { throw new Error('cache exploded') },
      enqueue: async () => { throw new Error('redis exploded') },
    })

    expect(result.invalidated).toEqual([])
    expect(result.failed.map((f) => f.kind)).toEqual(['invalidate:standings', 'league_engine:standings_refresh', 'ai:digest'])
    expect(result.failed[0].error).toBe('cache exploded')
  })

  it('dispatches with no handlers at all', async () => {
    await expect(dispatchReactions(event(), {})).resolves.toMatchObject({ enqueued: [], failed: [] })
  })

  it('reports every enqueue when they succeed', async () => {
    const enqueue = vi.fn(async () => ({ ok: true }))
    const result = await dispatchReactions(event(), { enqueue })
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(result.enqueued).toHaveLength(2)
    expect(result.failed).toEqual([])
  })
})
