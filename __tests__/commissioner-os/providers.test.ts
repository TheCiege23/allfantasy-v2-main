/**
 * Commissioner OS · T-201 acceptance.
 *
 * "The interface is implementable by a stub provider used in tests. A test
 * asserts no credential material appears in any audit row. T-103 passes."
 *
 * All three are here. The third is the interesting one: T-103 passing is not
 * asserted by claiming it — `policyCoverage.test.ts` failed BY NAME on
 * LeagueBinding and SyncJob before the register entry existed, and that
 * transition is what the ticket means by "which is the point".
 */

import { describe, it, expect } from 'vitest'
import {
  type Provider,
  type ProviderContext,
  bindingAuditDraft,
  createProviderRegistry,
  createStubProvider,
  providerError,
  resolvedSecret,
  secretRef,
  toDomainError,
} from '@/lib/domain/providers'
import { buildAuditRow } from '@/lib/domain/audit'
import { createActorContext, syntheticIntegrationActor } from '@/lib/domain/actorContext'
import { TENANT_SCOPED_TABLES } from '@/lib/domain/tenantScopedTables'

const SECRET = 'sleeper_live_TOKEN_c0ffee_do_not_leak'

const ctx = (secret: string | null = null): ProviderContext => ({
  tenantId: 't1',
  secret: secret === null ? null : resolvedSecret(secret),
  cursor: null,
})

describe('T-201 · the interface is implementable by a stub', () => {
  it('a stub satisfies the whole Provider type', async () => {
    // The acceptance criterion. If the interface could not be satisfied without
    // a network, every test downstream would need one — which is how a suite
    // ends up calling a third party in CI, and T-202 forbids exactly that.
    const p: Provider = createStubProvider()
    expect(p.key).toBe('stub')
    expect(typeof p.connect).toBe('function')
    expect(typeof p.fetchTeams).toBe('function')
    expect(typeof p.fetchManagers).toBe('function')
    expect(p.capabilities).toMatchObject({ incremental: expect.any(Boolean) })
  })

  it('connects to a known league', async () => {
    const p = createStubProvider()
    const r = await p.connect('ext-1', ctx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({ externalLeagueId: 'ext-1', name: 'Stub League' })
  })

  it('reports an unknown league as NOT_FOUND rather than throwing', async () => {
    const r = await createStubProvider().connect('nope', ctx())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('NOT_FOUND')
  })

  it('returns pages with an opaque cursor', async () => {
    const p = createStubProvider({ teams: [{ externalTeamId: 't', name: 'T', externalManagerId: 'm' }] })
    const r = await p.fetchTeams('ext-1', ctx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.items).toHaveLength(1)
    expect(r.value.nextCursor).toBeNull()
  })

  it('surfaces a configured failure', async () => {
    const p = createStubProvider({ failWith: providerError('UNAVAILABLE', 'Provider is down.') })
    const r = await p.connect('ext-1', ctx())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.retryable).toBe(true)
  })

  it('classifies retryability sensibly by default', () => {
    // Drives T-204's DEGRADED transition. A 404 retried forever is a job that
    // never finishes; a 429 not retried is a sync that gives up on a hiccup.
    expect(providerError('RATE_LIMITED', 'x').retryable).toBe(true)
    expect(providerError('UNAVAILABLE', 'x').retryable).toBe(true)
    expect(providerError('NOT_FOUND', 'x').retryable).toBe(false)
    expect(providerError('UNAUTHORIZED', 'x').retryable).toBe(false)
    expect(providerError('MALFORMED', 'x').retryable).toBe(false)
  })

  it('maps to the domain error vocabulary', () => {
    const e = toDomainError(providerError('UNAUTHORIZED', 'Token rejected.'))
    expect(e.code).toBe('INVARIANT')
    expect(e).toMatchObject({ invariant: 'provider.unauthorized' })
  })
})

describe('T-201 · 🛑 no credential material reaches an audit row', () => {
  it('the binding audit draft carries neither the secret nor its reference', () => {
    // The reference is omitted as well as the value: it is a pointer to
    // credential material, and an operator who can read and export their audit
    // would learn exactly which handle to ask for.
    const draft = bindingAuditDraft({
      bindingId: 'b1',
      leagueId: 'l1',
      provider: 'sleeper',
      externalLeagueId: 'ext-1',
    })
    const serialised = JSON.stringify(draft)
    expect(serialised).not.toContain(SECRET)
    expect(serialised).not.toContain('secretRef')
    expect(draft.after).toEqual({ provider: 'sleeper', externalLeagueId: 'ext-1' })
  })

  it('survives an end-to-end audit row build', () => {
    // Through buildAuditRow, not just the draft — the same gap that caught the
    // export redaction: a helper can be correct while the path that ships does
    // not use it.
    const actor = createActorContext({ userId: 'u1', actorLabel: 'Dana', tenantId: 't1' })
    if (!actor.ok) throw new Error('bad fixture')

    const row = buildAuditRow(
      actor.value,
      bindingAuditDraft({ bindingId: 'b1', leagueId: 'l1', provider: 'sleeper', externalLeagueId: 'ext-1' }),
    )
    expect(JSON.stringify(row)).not.toContain(SECRET)
  })

  it('redacts a credential even if a careless caller puts one in the draft', () => {
    // The acceptance says NO credential material in ANY audit row — not "in the
    // drafts we remembered to write carefully". buildAuditRow redacts by key,
    // so a future caller who spreads a provider config into metadata is caught
    // by the writer rather than by review.
    const actor = createActorContext({ userId: 'u1', actorLabel: 'Dana', tenantId: 't1' })
    if (!actor.ok) throw new Error('bad fixture')

    const row = buildAuditRow(actor.value, {
      action: 'league.binding.connect',
      resourceType: 'LeagueBinding',
      resourceId: 'b1',
      metadata: { providerConfig: { token: SECRET, apiKey: SECRET, url: 'https://api.sleeper.app' } },
      after: { secret: SECRET, credential: SECRET },
    })

    const serialised = JSON.stringify(row)
    expect(serialised).not.toContain(SECRET)
    // The non-sensitive sibling survives — redaction narrows, it does not drop.
    expect(serialised).toContain('api.sleeper.app')
  })

  it('a sync-caused audit row is attributable to the provider, not a person', () => {
    // T-203 depends on this being distinguishable. `integration:sleeper` rather
    // than a userId that looks human.
    const actor = syntheticIntegrationActor('t1', 'sleeper')
    if (!actor.ok) throw new Error('bad fixture')
    const row = buildAuditRow(actor.value, {
      action: 'league.binding.sync',
      resourceType: 'LeagueBinding',
      resourceId: 'b1',
    })
    expect(row.actorUserId).toBe('integration:sleeper')
    expect(row.tenantRole).toBeNull()
    expect(row.platformRole).toBeNull()
  })
})

describe('T-201 · a provider only ever holds a handle', () => {
  it('resolves a secret through the store, scoped to a callback', async () => {
    const seen: string[] = []
    const p = createStubProvider({ credentialSink: seen })
    await p.connect('ext-1', ctx(SECRET))
    // It CAN see the value when it needs it — otherwise the design would be
    // unusable rather than safe.
    expect(seen).toEqual([SECRET])
  })

  it('sees nothing when no secret is supplied', async () => {
    const seen: string[] = []
    const p = createStubProvider({ credentialSink: seen })
    await p.connect('ext-1', ctx(null))
    expect(seen).toEqual([])
  })

  it('a SecretRef is a handle, never the material', () => {
    const ref = secretRef('vault://tenants/t1/sleeper')
    expect(String(ref)).not.toContain(SECRET)
    expect(String(ref)).toContain('vault://')
  })

  it('the ProviderError type gives a raw error nowhere to live', async () => {
    // A field that does not exist cannot be populated by a hurried
    // `catch (e) { summary: String(e) }` — and a provider error routinely
    // embeds the request URL, which for Rolling Insights carries the token as a
    // query parameter (root CLAUDE.md).
    const e = providerError('UNAVAILABLE', 'Provider returned 503.')
    expect(Object.keys(e).sort()).toEqual(['kind', 'retryable', 'summary'])
  })
})

describe('T-201 · the registry', () => {
  it('resolves a registered provider', () => {
    const r = createProviderRegistry([createStubProvider()]).get('stub')
    expect(r.ok).toBe(true)
  })

  it('fails closed on an unknown key', () => {
    // A binding naming a provider we do not have is a configuration error, not
    // a reason to guess at the nearest match.
    const r = createProviderRegistry([createStubProvider()]).get('sleeper')
    expect(r.ok).toBe(false)
  })

  it('refuses duplicate keys at construction', () => {
    // A duplicate silently shadows: the later registration wins and the earlier
    // provider is unreachable while still appearing configured.
    expect(() =>
      createProviderRegistry([createStubProvider({ key: 'a' }), createStubProvider({ key: 'a' })]),
    ).toThrow(/Duplicate/)
  })
})

describe('T-201 · 🛑 T-103 passes — and it did not before', () => {
  it('LeagueBinding and SyncJob are registered as RLS-protected', () => {
    // HANDOFF.md: "Both gain tenantId and RLS policies here — T-103's coverage
    // test will fail otherwise, WHICH IS THE POINT."
    //
    // It did fail, by name, before this entry existed:
    //   "Models carry tenantId but are neither RLS-protected nor registered as
    //    deferred: LeagueBinding, SyncJob"
    //
    // That is §3.5 catching a table on the day it is added rather than in month
    // nine. Asserting the registration here means removing it breaks two tests
    // rather than one, and the other one names the mechanism.
    const byModel = new Map(TENANT_SCOPED_TABLES.map((t) => [t.model, t]))
    for (const model of ['LeagueBinding', 'SyncJob']) {
      const entry = byModel.get(model)
      expect(entry, `${model} is not registered`).toBeDefined()
      expect(entry!.rlsEnabled, `${model} is registered but not RLS-protected`).toBe(true)
      expect(entry!.keyColumn).toBe('tenantId')
    }
  })

  it('the T-201 migration creates a policy for both', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const sql = readFileSync(
      path.resolve(
        process.cwd(),
        'prisma/migrations-pending/20260831190000_commissioner_os_t201_binding/migration.sql',
      ),
      'utf8',
    )
    const loop = /FOREACH t IN ARRAY ARRAY\[([^\]]+)\]/.exec(sql)
    expect(loop).not.toBeNull()
    expect(loop![1].split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([
      'LeagueBinding',
      'SyncJob',
    ])
    expect(sql).toContain('FORCE ROW LEVEL SECURITY')
    // The suspension predicate is present from the start on these, unlike the
    // T-102 tables which had it added by T-106.
    expect(sql).toContain('app.tenant_is_writable')
  })

  it('stores a credential REFERENCE, never a credential', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const schema = readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    const model = /^model LeagueBinding \{[\s\S]*?^\}/m.exec(schema)
    expect(model).not.toBeNull()
    expect(model![0]).toContain('secretRef')
    // No column that would invite storing the material itself.
    expect(model![0]).not.toMatch(/^\s+(token|apiKey|secret|password)\s/m)
  })
})
