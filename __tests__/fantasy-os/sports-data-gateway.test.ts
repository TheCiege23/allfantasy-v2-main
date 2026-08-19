import { describe, it, expect } from 'vitest'
import { CapabilityRegistry, type ProviderCapabilityDeclaration } from '@/lib/sports-data-gateway/capabilities'
import { selectProvider, type ProviderPriorityRule } from '@/lib/sports-data-gateway/selection'
import { resolveIdentity, type MappingSource } from '@/lib/sports-data-gateway/resolution'
import { validateShape, validateBatch } from '@/lib/sports-data-gateway/schema'
import { SportsDataGateway } from '@/lib/sports-data-gateway/gateway'
import { BaseProviderAdapter, type ProviderHealth } from '@/lib/sports-data-gateway/adapter'
import { GatewayDraftPort } from '@/lib/sports-data-gateway/ports'
import { mapPlayer } from '@/lib/sports-data-gateway/providers/sleeper'
import type { CanonicalPlayer } from '@/lib/sports-data-gateway/contracts'
import type { ProviderResult } from '@/lib/sports-data-gateway/errors'

const decl = (provider: string, caps: ProviderCapabilityDeclaration['capabilities']): ProviderCapabilityDeclaration => ({ provider, sports: ['NFL'], capabilities: caps, refreshSupport: {}, limitations: [] })

const cp = (over: Partial<CanonicalPlayer> = {}): CanonicalPlayer => ({
  canonicalPlayerId: 'unresolved:fakeA:1', sport: 'NFL', providerIds: { fakeA: '1' }, firstName: 'A', lastName: 'B',
  displayName: 'A B', position: 'QB', positions: ['QB'], teamId: 'SF', status: null, injuryStatus: null, active: true,
  metadata: { birthDate: null }, source: { primaryProvider: 'fakeA', providerRecordId: '1', fetchedAt: 't', sourceUpdatedAt: null, snapshotVersion: 'v1' }, ...over,
})

class FakePlayersAdapter extends BaseProviderAdapter {
  constructor(public provider: string, private behavior: 'ok' | 'unavailable' | 'partial' = 'ok') { super() }
  getCapabilities() { return decl(this.provider, ['players']) }
  async healthCheck(): Promise<ProviderHealth> { return { provider: this.provider, state: 'healthy', checkedAt: 't', latencyMs: 1 } }
  async fetchPlayers(): Promise<ProviderResult<CanonicalPlayer[]>> {
    if (this.behavior === 'unavailable') return { ok: false, provider: this.provider, error: { code: 'provider_unavailable', provider: this.provider, message: 'down', retriable: true } }
    return { ok: true, provider: this.provider, data: [cp({ source: { primaryProvider: this.provider, providerRecordId: '1', fetchedAt: 't', sourceUpdatedAt: null, snapshotVersion: `${this.provider}-v1` }, providerIds: { [this.provider]: '1' } })], partial: this.behavior === 'partial', fetchedAt: 't', snapshotVersion: `${this.provider}-v1` }
  }
}

describe('capability registry', () => {
  it('reports providers for a (sport, capability) and rejects unsupported', () => {
    const r = new CapabilityRegistry()
    r.register(decl('a', ['players', 'teams']))
    r.register(decl('b', ['injuries']))
    expect(r.providersFor('NFL', 'players')).toEqual(['a'])
    expect(r.supports('a', 'NFL', 'players')).toBe(true)
    expect(r.supports('b', 'NFL', 'players')).toBe(false)
    expect(r.providersFor('NFL', 'projections')).toEqual([])
  })
})

describe('provider selection + fallback', () => {
  const registry = new CapabilityRegistry()
  registry.register(decl('primaryP', ['players']))
  registry.register(decl('fallbackP', ['players']))
  const rules: ProviderPriorityRule[] = [{ sport: 'NFL', capability: 'players', primary: 'primaryP', fallbacks: ['fallbackP'], minimumFreshnessMinutes: 30 }]

  it('selects the primary when healthy', () => {
    const s = selectProvider({ sport: 'NFL', capability: 'players', registry, rules })
    expect(s.selected && s.selectedProvider).toBe('primaryP')
    expect(s.selected && s.fallbackUsed).toBe(false)
  })
  it('falls back when the primary is unhealthy (capability-specific)', () => {
    const s = selectProvider({ sport: 'NFL', capability: 'players', registry, rules, health: { primaryP: 'authentication_failed' } })
    expect(s.selected && s.selectedProvider).toBe('fallbackP')
    expect(s.selected && s.fallbackUsed).toBe(true)
  })
  it('reports no provider for an unsupported capability (never silent)', () => {
    const s = selectProvider({ sport: 'NFL', capability: 'projections', registry, rules })
    expect(s.selected).toBe(false)
  })
})

describe('canonical identity resolution', () => {
  const source: MappingSource = {
    byProviderId: (_p, id) => (id === 'CERT1' ? 'canon-1' : null),
    candidatesBySignals: (ev) => (ev.position === 'QB' && ev.team === 'SF' ? ['canon-2'] : ev.position === 'RB' ? ['canon-a', 'canon-b'] : []),
  }
  it('resolves via a certified provider-id mapping', () => {
    expect(resolveIdentity({ provider: 'p', providerId: 'CERT1', sport: 'NFL' }, source)).toMatchObject({ status: 'resolved', canonicalPlayerId: 'canon-1' })
  })
  it('resolves a single corroborated candidate', () => {
    expect(resolveIdentity({ provider: 'p', providerId: 'X', sport: 'NFL', team: 'SF', position: 'QB' }, source)).toMatchObject({ status: 'resolved', canonicalPlayerId: 'canon-2' })
  })
  it('quarantines ambiguous (multiple candidates), never merges', () => {
    expect(resolveIdentity({ provider: 'p', providerId: 'X', sport: 'NFL', position: 'RB' }, source).status).toBe('ambiguous')
  })
  it('never resolves on name alone', () => {
    expect(resolveIdentity({ provider: 'p', providerId: 'X', sport: 'NFL', displayName: 'John Smith' }, source).status).toBe('unresolved')
  })
  it('unresolved when corroboration matches nothing', () => {
    expect(resolveIdentity({ provider: 'p', providerId: 'X', sport: 'NFL', position: 'WR', team: 'NE' }, source).status).toBe('unresolved')
  })
})

describe('schema-drift protection', () => {
  const spec = [{ key: 'id', type: 'string' as const, required: true }, { key: 'n', type: 'number' as const, required: false }]
  it('accepts a valid record', () => expect(validateShape({ id: 'x', n: 1 }, spec).ok).toBe(true))
  it('rejects a missing required field with a redacted path', () => {
    const v = validateShape({ n: 1 }, spec)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.schemaPath).toBe('$.id')
  })
  it('rejects a wrong type', () => expect(validateShape({ id: 5 }, spec).ok).toBe(false))
  it('counts rejected records in a batch', () => {
    const { rejected } = validateBatch([{ id: 'a' }, { n: 2 }, { id: 'c' }], spec)
    expect(rejected).toBe(1)
  })
})

describe('Sleeper adapter normalization (offline)', () => {
  it('maps a raw Sleeper player to canonical + provenance, provider id not canonical', () => {
    const p = mapPlayer('123', { player_id: '123', first_name: 'Patrick', last_name: 'Mahomes', position: 'QB', fantasy_positions: ['QB'], team: 'KC', active: true }, 't', 'v1')!
    expect(p.displayName).toBe('Patrick Mahomes')
    expect(p.providerIds.sleeper).toBe('123')
    expect(p.canonicalPlayerId).toBe('unresolved:sleeper:123') // not resolved here — gateway resolution assigns it
    expect(p.source.primaryProvider).toBe('sleeper')
  })
  it('rejects a record with no usable name', () => {
    expect(mapPlayer('x', { player_id: 'x' }, 't', 'v1')).toBeNull()
  })
})

describe('gateway dispatch (fail-closed, fallback, provenance)', () => {
  const rules: ProviderPriorityRule[] = [{ sport: 'NFL', capability: 'players', primary: 'primaryP', fallbacks: ['fallbackP'], minimumFreshnessMinutes: 30 }]

  it('returns normalized players with a current freshness context', async () => {
    const gw = new SportsDataGateway([new FakePlayersAdapter('primaryP', 'ok')], { rules, lastSuccessfulSyncAt: '2026-07-11T00:00:00Z' })
    const read = await gw.getPlayers({ sport: 'NFL', limit: 5 })
    expect(read.result.ok).toBe(true)
    expect(read.context.freshnessStatus).toBe('current')
    expect(read.context.sourceProviders).toEqual(['primaryP'])
  })

  it('falls back to the secondary provider at runtime and records provenance', async () => {
    const gw = new SportsDataGateway([new FakePlayersAdapter('primaryP', 'unavailable'), new FakePlayersAdapter('fallbackP', 'ok')], { rules })
    const read = await gw.getPlayers({ sport: 'NFL' })
    expect(read.result.ok).toBe(true)
    expect(read.context.sourceProviders).toEqual(['fallbackP'])
  })

  it('fails closed for an unsupported capability — no fabricated data', async () => {
    const gw = new SportsDataGateway([new FakePlayersAdapter('primaryP', 'ok')], { rules })
    // projections unsupported by any adapter
    const read = await gw['dispatch']('NFL', 'projections', async () => ({ ok: false, provider: 'x', error: { code: 'unsupported_capability', provider: 'x', message: 'no', retriable: false } }))
    expect(read.result.ok).toBe(false)
    expect(read.context.freshnessStatus).toBe('unavailable')
    expect(read.context.sourceProviders).toEqual([])
  })

  it('marks partial provider results as partial freshness', async () => {
    const gw = new SportsDataGateway([new FakePlayersAdapter('primaryP', 'partial')], { rules })
    const read = await gw.getPlayers({ sport: 'NFL' })
    expect(read.context.freshnessStatus).toBe('partial')
  })
})

describe('subsystem port consumes the gateway (not a raw client)', () => {
  const rules: ProviderPriorityRule[] = [{ sport: 'NFL', capability: 'players', primary: 'primaryP', fallbacks: [], minimumFreshnessMinutes: 30 }]
  const source: MappingSource = { byProviderId: (_p, id) => (id === '1' ? 'canon-1' : null), candidatesBySignals: () => [] }

  it('Draft port returns resolved player contexts with freshness', async () => {
    const gw = new SportsDataGateway([new FakePlayersAdapter('primaryP', 'ok')], { rules, lastSuccessfulSyncAt: '2026-07-11T00:00:00Z' })
    const port = new GatewayDraftPort(gw, source)
    const { data, context } = await port.getDraftablePlayers({ sport: 'NFL' })
    expect(data.length).toBe(1)
    expect(data[0].canonicalPlayerId).toBe('canon-1')
    expect(data[0].resolutionStatus).toBe('resolved')
    expect(context.freshnessStatus).toBe('current')
  })

  it('Draft port fails closed on gateway outage — empty list, no fabrication', async () => {
    const gw = new SportsDataGateway([new FakePlayersAdapter('primaryP', 'unavailable')], { rules })
    const port = new GatewayDraftPort(gw, source)
    const { data, context } = await port.getDraftablePlayers({ sport: 'NFL' })
    expect(data).toEqual([])
    expect(context.freshnessStatus).toBe('unavailable')
  })
})
