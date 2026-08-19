import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getEventInfrastructure,
  configureEventInfrastructure,
  resetEventInfrastructure,
  getEventPublisher,
  InMemoryOutboxStore,
  InMemoryEventSchemaRegistry,
  InProcessEventBus,
  EventPublisher,
  EventNormalizer,
  OutboxRelay,
  type DomainEvent,
} from '@/lib/events'
import { leagueRealtimeStore } from '@/lib/league-events/realtime-store'

describe('event infrastructure container (DI)', () => {
  beforeEach(() => resetEventInfrastructure())

  it('builds a consistent default graph and caches it', () => {
    const a = getEventInfrastructure()
    const b = getEventInfrastructure()
    expect(a).toBe(b) // cached singleton
    expect(a.registry).toBeDefined()
    expect(a.publisher).toBeDefined()
    expect(a.relay).toBeDefined()
    expect(a.bus).toBeDefined()
  })

  it('configure swaps components and rewires dependents consistently', async () => {
    const store = new InMemoryOutboxStore()
    const bus = new InProcessEventBus()
    const infra = configureEventInfrastructure({ outboxStore: store, bus })
    expect(infra.outboxStore).toBe(store)
    expect(infra.bus).toBe(bus)

    // publisher + relay must be wired to the swapped store/bus
    const received: DomainEvent[] = []
    bus.subscribe('*', (e) => {
      received.push(e)
    })
    await getEventPublisher().publish({ type: 'demo.event', payload: { ok: true }, metadata: { source: 'test' } })
    expect(store.outbox.size).toBe(1)
    const summary = await infra.relay.dispatchPending()
    expect(summary.dispatched).toBe(1)
    expect(received).toHaveLength(1)
  })

  it('reset restores defaults', () => {
    const swapped = configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })
    resetEventInfrastructure()
    const fresh = getEventInfrastructure()
    expect(fresh).not.toBe(swapped)
  })

  it('end-to-end: publish -> relay -> bus handler (full in-memory pipeline)', async () => {
    const store = new InMemoryOutboxStore()
    const bus = new InProcessEventBus()
    const reg = new InMemoryEventSchemaRegistry()
    const publisher = new EventPublisher(new EventNormalizer(reg), store)
    const relay = new OutboxRelay(store, { bus })
    const seen: string[] = []
    bus.subscribe('lifecycle.*', (e) => {
      seen.push(e.type)
    })
    await publisher.publish({ type: 'lifecycle.league.created', payload: { leagueId: 'L1' }, metadata: { source: 'engine' } })
    await relay.dispatchPending()
    expect(seen).toEqual(['lifecycle.league.created'])
  })
})

describe('backward compatibility — existing realtime systems are untouched', () => {
  beforeEach(() => resetEventInfrastructure())

  it('the new event bus and the legacy realtime store are independent singletons', () => {
    const infra = getEventInfrastructure()
    // Different objects; the new infra does not wrap or replace the legacy store.
    expect(infra.bus as unknown).not.toBe(leagueRealtimeStore as unknown)
  })

  it('publishing on the new bus never invokes legacy realtime subscribers', async () => {
    const legacyListener = vi.fn()
    const off = leagueRealtimeStore.subscribe('league-xyz', legacyListener)
    const store = new InMemoryOutboxStore()
    const bus = new InProcessEventBus()
    configureEventInfrastructure({ outboxStore: store, bus })
    await getEventPublisher().publish({
      type: 'competition.score.updated',
      leagueId: 'league-xyz',
      payload: {},
      metadata: { source: 'engine' },
    })
    await getEventInfrastructure().relay.dispatchPending()
    expect(legacyListener).not.toHaveBeenCalled()
    off()
  })

  it('the legacy realtime store still works exactly as before', () => {
    const listener = vi.fn()
    const off = leagueRealtimeStore.subscribe('L', listener)
    leagueRealtimeStore.publish('L', { eventType: 'player_changed', meta: { x: 1 } })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toMatchObject({ kind: 'league_event', leagueId: 'L', eventType: 'player_changed' })
    off()
  })
})
