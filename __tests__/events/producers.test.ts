import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  configureEventInfrastructure,
  resetEventInfrastructure,
  getEventInfrastructure,
  InMemoryOutboxStore,
  InMemoryEventSchemaRegistry,
  PlatformEventProducer,
  getPlatformEvents,
  resetPlatformEvents,
  EVENT,
  type IEventPublisher,
} from '@/lib/events'

describe('PlatformEventProducer (publishing convention)', () => {
  let store: InMemoryOutboxStore

  beforeEach(() => {
    resetEventInfrastructure()
    resetPlatformEvents()
    store = new InMemoryOutboxStore()
    configureEventInfrastructure({ outboxStore: store, registry: new InMemoryEventSchemaRegistry() })
  })

  it('emit records a valid catalog event with type + version + payload + source', async () => {
    const e = await getPlatformEvents().emit(EVENT.CHAMPION_CROWNED, {
      leagueId: 'L',
      seasonId: 'S',
      sport: 'NBA',
      leagueConcept: 'dynasty',
      actor: { type: 'system' },
      idempotencyKey: 'champion.crowned:S',
      source: 'engine:playoff',
      payload: { seasonId: 'S', championRosterId: 'r1' },
    })
    expect(e).not.toBeNull()
    const stored = store.events.get('champion.crowned:S')!
    expect(stored.type).toBe(EVENT.CHAMPION_CROWNED)
    expect(stored.schemaVersion).toBe(1)
    expect(stored.sport).toBe('NBA')
    expect(stored.leagueConcept).toBe('dynasty')
    expect(stored.payload).toMatchObject({ seasonId: 'S', championRosterId: 'r1' })
    expect(stored.metadata.source).toBe('engine:playoff')
  })

  it('getPlatformEvents registers the catalog schemas into the infra registry', () => {
    getPlatformEvents()
    expect(getEventInfrastructure().registry.has(EVENT.CHAMPION_CROWNED, 1)).toBe(true)
    expect(getEventInfrastructure().registry.has(EVENT.TRADE_ACCEPTED, 1)).toBe(true)
  })

  it('emit is best-effort: returns null and never throws when publishing fails', async () => {
    const failing: IEventPublisher = { publish: vi.fn(async () => { throw new Error('transport down') }) }
    const p = new PlatformEventProducer(failing)
    await expect(p.emit(EVENT.TRADE_ACCEPTED, { payload: { tradeId: 't1' } })).resolves.toBeNull()
  })

  it('emit swallows invalid payloads (validation failure never breaks the caller)', async () => {
    // catalog is registered via getPlatformEvents → invalid payload fails the normalizer → caught → null
    const r = await getPlatformEvents().emit(EVENT.TRADE_ACCEPTED, { payload: {} as never })
    expect(r).toBeNull()
    expect(store.events.size).toBe(0)
  })

  it('emitInTx passes the transaction handle through (atomic) and returns the event', async () => {
    const calls: { input: unknown; opts: unknown }[] = []
    const pub: IEventPublisher = {
      publish: vi.fn(async (input: unknown, opts?: unknown) => {
        calls.push({ input, opts: opts ?? null })
        return input as never
      }),
    }
    const p = new PlatformEventProducer(pub)
    const tx = { marker: 'tx' }
    await p.emitInTx(tx, EVENT.SEASON_COMPLETED, { seasonId: 'S', payload: { seasonId: 'S' } })
    expect(calls[0].opts).toEqual({ tx })
  })

  it('emitInTx propagates errors (transactional atomicity — caller can roll back)', async () => {
    const pub: IEventPublisher = { publish: vi.fn(async () => { throw new Error('tx insert failed') }) }
    const p = new PlatformEventProducer(pub)
    await expect(p.emitInTx({}, EVENT.SEASON_COMPLETED, { payload: { seasonId: 'S' } })).rejects.toThrow('tx insert failed')
  })
})
