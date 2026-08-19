import { describe, it, expect } from 'vitest'
import {
  InMemoryEventSchemaRegistry,
  registerPlatformEventSchemas,
  ALL_EVENT_TYPES,
  EVENT,
  EVENT_SCHEMA_VERSION,
} from '@/lib/events'

describe('event catalog', () => {
  it('registers every catalog type and is idempotent', () => {
    const reg = new InMemoryEventSchemaRegistry()
    registerPlatformEventSchemas(reg)
    for (const t of ALL_EVENT_TYPES) {
      expect(reg.has(t, EVENT_SCHEMA_VERSION[t])).toBe(true)
    }
    expect(() => registerPlatformEventSchemas(reg)).not.toThrow() // idempotent re-register
  })

  it('declares a version (>=1) for every type', () => {
    for (const t of ALL_EVENT_TYPES) expect(EVENT_SCHEMA_VERSION[t]).toBeGreaterThanOrEqual(1)
  })

  it('covers all required domains', () => {
    const prefixes = new Set(ALL_EVENT_TYPES.map((t) => t.split('.')[0]))
    for (const p of ['lifecycle', 'draft', 'roster', 'transaction', 'competition', 'governance', 'user', 'chat', 'auth', 'billing']) {
      expect(prefixes.has(p)).toBe(true)
    }
  })

  it('validates good payloads and rejects malformed ones', () => {
    const reg = new InMemoryEventSchemaRegistry()
    registerPlatformEventSchemas(reg)
    expect(reg.validate(EVENT.CHAMPION_CROWNED, 1, { seasonId: 's1', championRosterId: 'r1' }).ok).toBe(true)
    expect(reg.validate(EVENT.CHAMPION_CROWNED, 1, {}).ok).toBe(false)
    expect(reg.validate(EVENT.TRADE_ACCEPTED, 1, { tradeId: 't1' }).ok).toBe(true)
    expect(reg.validate(EVENT.TRADE_ACCEPTED, 1, {}).ok).toBe(false)
    expect(reg.validate(EVENT.WAIVER_PROCESSED, 1, { result: 'success' }).ok).toBe(true)
    expect(reg.validate(EVENT.ENTITLEMENT_CHANGED, 1, { userId: 'u', feature: 'x', granted: true }).ok).toBe(true)
    expect(reg.validate(EVENT.ENTITLEMENT_CHANGED, 1, { userId: 'u', feature: 'x' }).ok).toBe(false)
  })
})
