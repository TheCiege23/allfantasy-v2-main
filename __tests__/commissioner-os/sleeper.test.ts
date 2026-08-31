/**
 * Commissioner OS · T-202 acceptance.
 *
 * "Recorded fixtures in CI — no live third-party calls in the gate. One
 * optional live smoke test outside it. Reconnecting is idempotent: running sync
 * twice produces no duplicate rows and no spurious audit entries."
 *
 * The live smoke test is `sleeperLive.spec.ts`, which the default vitest config
 * does not collect. Everything here is served from
 * `fixtures/sleeper/`, and the first test asserts the adapter is structurally
 * incapable of reaching the network rather than merely declining to.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  SLEEPER_PROVIDER_KEY,
  type ExistingBinding,
  type SleeperHttp,
  createSleeperProvider,
  managerDisplayName,
  mapLeague,
  mapManagers,
  mapTeams,
  planConnect,
  planShouldAudit,
} from '@/lib/domain/sleeper'
import { providerError } from '@/lib/domain/providers'
import { ok, err } from '@/lib/domain/result'

const FIXTURES = path.resolve(process.cwd(), '__tests__/commissioner-os/fixtures/sleeper')
const fixture = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))

const LEAGUE_ID = '1048291837465920512'

/** Serves recorded fixtures. Records every path asked for. */
function recordedHttp(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const http: SleeperHttp = async (p) => {
    calls.push(p)
    if (p in overrides) {
      const v = overrides[p]
      return v instanceof Error ? err(providerError('UNAVAILABLE', v.message)) : ok(v)
    }
    if (p === `/league/${LEAGUE_ID}`) return ok(fixture('league.json'))
    if (p === `/league/${LEAGUE_ID}/rosters`) return ok(fixture('rosters.json'))
    if (p === `/league/${LEAGUE_ID}/users`) return ok(fixture('users.json'))
    return ok(null)
  }
  return { http, calls }
}

const ctx = { tenantId: 't1', secret: null, cursor: null }

describe('T-202 · 🛑 no live third-party calls in the gate', () => {
  it('the adapter names no host and imports no fetch', () => {
    // Structural, not behavioural. An adapter that constructs its own client can
    // only be tested against the real service, so the fixture requirement has to
    // be designed in — asserting "we did not call out" would pass for a version
    // that simply was not exercised.
    //
    // ⚠ api.sleeper.app is on the DB-first guard's monitored host list
    // (scripts/check-db-first-api-boundary.mjs:10), so keeping the literal out
    // of the domain layer also keeps the guard's job to one file.
    const src = readFileSync(path.resolve(process.cwd(), 'lib/domain/sleeper.ts'), 'utf8')
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
      .join('\n')
    expect(code).not.toContain('https://')
    expect(code).not.toContain('api.sleeper')
    expect(code).not.toMatch(/\bfetch\s*\(/)
  })

  it('the fixtures load and are non-trivial (positive control)', () => {
    // Without this, a broken fixture path would make every mapping test below
    // assert against `undefined` and pass or fail for unrelated reasons.
    expect(fixture('league.json').league_id).toBe(LEAGUE_ID)
    expect(fixture('rosters.json')).toHaveLength(4)
    expect(fixture('users.json')).toHaveLength(3)
  })
})

describe('T-202 · connect', () => {
  it('maps a league from the recorded fixture', async () => {
    const { http, calls } = recordedHttp()
    const r = await createSleeperProvider(http).connect(LEAGUE_ID, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({
      externalLeagueId: LEAGUE_ID,
      name: 'Dynasty Warriors',
      season: '2026',
      teamCount: 4,
    })
    expect(calls).toEqual([`/league/${LEAGUE_ID}`])
  })

  it('🛑 reports an unknown league as NOT_FOUND, not MALFORMED', async () => {
    // Sleeper answers an unknown league with `null` and a 200, not a 404.
    // Without the null branch a typo'd id becomes a parse failure, and the
    // operator is told our integration is broken rather than that their id is
    // wrong. The fixture is literally `null` for that reason.
    const { http } = recordedHttp({ [`/league/nope`]: fixture('league-unknown.json') })
    const r = await createSleeperProvider(http).connect('nope', ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('NOT_FOUND')
    expect(r.error.retryable).toBe(false)
  })

  it('propagates a transport failure as retryable', async () => {
    const { http } = recordedHttp({ [`/league/${LEAGUE_ID}`]: new Error('socket hang up') })
    const r = await createSleeperProvider(http).connect(LEAGUE_ID, ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.retryable).toBe(true)
  })

  it('url-encodes the external id', async () => {
    const { http, calls } = recordedHttp()
    await createSleeperProvider(http).connect('a/../b', ctx)
    // Otherwise a crafted id walks the path — `a/../b` would hit /league/b, and
    // an id is untrusted operator input.
    expect(calls[0]).toBe('/league/a%2F..%2Fb')
  })

  it('needs no credential', async () => {
    const p = createSleeperProvider(recordedHttp().http)
    expect(p.capabilities.requiresCredential).toBe(false)
    expect(p.key).toBe(SLEEPER_PROVIDER_KEY)
  })
})

describe('T-202 · teams and managers', () => {
  it('maps four teams from four rosters', async () => {
    const { http } = recordedHttp()
    const r = await createSleeperProvider(http).fetchTeams(LEAGUE_ID, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.items).toHaveLength(4)
    expect(r.value.nextCursor).toBeNull()
  })

  it('🛑 an UNCLAIMED roster is normal, not an error', async () => {
    // owner_id: null appears in most real leagues — a co-manager left, a slot
    // was never filled. Treating it as malformed refuses to sync a league for
    // being ordinary, and the fixture carries one deliberately.
    const { http } = recordedHttp()
    const r = await createSleeperProvider(http).fetchTeams(LEAGUE_ID, ctx)
    if (!r.ok) throw new Error('expected success')
    const orphan = r.value.items.find((t) => t.externalTeamId === '4')
    expect(orphan).toBeDefined()
    expect(orphan!.externalManagerId).toBeNull()
    expect(orphan!.name).toBe('Team 4')
  })

  it('resolves names in the repo’s existing fallback order', () => {
    // team_name → display_name → username, matching
    // lib/ai-tools-start-sit/opponentMatchup.ts:65. Falling back differently
    // would show a different name from the rest of the product for the same
    // person in the same league.
    const users = fixture('users.json')
    expect(managerDisplayName(users[0])).toBe('Okafor Dynasty')
    expect(managerDisplayName(users[1])).toBe('mike_t')
    expect(managerDisplayName(users[2])).toBe('sam_only_username')
  })

  it('names teams from their owner', async () => {
    const { http } = recordedHttp()
    const r = await createSleeperProvider(http).fetchTeams(LEAGUE_ID, ctx)
    if (!r.ok) throw new Error('expected success')
    expect(r.value.items.find((t) => t.externalTeamId === '1')!.name).toBe('Okafor Dynasty')
    expect(r.value.items.find((t) => t.externalTeamId === '3')!.name).toBe('sam_only_username')
  })

  it('🛑 every manager email is null, and that is Sleeper', async () => {
    // Sleeper does not expose them. A reconciler that keys on email would
    // silently drop every manager on the first platform this phase integrates —
    // which is why ExternalManager.email is nullable at all.
    const { http } = recordedHttp()
    const r = await createSleeperProvider(http).fetchManagers(LEAGUE_ID, ctx)
    if (!r.ok) throw new Error('expected success')
    expect(r.value.items).toHaveLength(3)
    for (const m of r.value.items) expect(m.email).toBeNull()
    expect(createSleeperProvider(http).capabilities.providesManagerEmail).toBe(false)
  })

  it('declares itself non-incremental rather than faking a cursor', async () => {
    // Sleeper returns everything at once. Claiming incremental support would
    // make every sync silently full while the cursor machinery pretended
    // otherwise.
    const p = createSleeperProvider(recordedHttp().http)
    expect(p.capabilities.incremental).toBe(false)
    const r = await p.fetchTeams(LEAGUE_ID, ctx)
    expect(r.ok && r.value.nextCursor).toBeNull()
  })
})

describe('T-202 · malformed provider data is refused, not thrown', () => {
  it('a non-list rosters response', async () => {
    const { http } = recordedHttp({ [`/league/${LEAGUE_ID}/rosters`]: { not: 'a list' } })
    const r = await createSleeperProvider(http).fetchTeams(LEAGUE_ID, ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('MALFORMED')
  })

  it('a roster with no roster_id', () => {
    expect(mapTeams([{ owner_id: 'x' }], []).ok).toBe(false)
  })

  it('a user with no user_id', () => {
    expect(mapManagers([{ display_name: 'x' }]).ok).toBe(false)
  })

  it('a league with no league_id', () => {
    expect(mapLeague({ name: 'x' }).ok).toBe(false)
  })

  it('a nameless league falls back to its id rather than a blank', () => {
    const r = mapLeague({ league_id: 'abc' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.name).toBe('Sleeper league abc')
  })

  it('never throws on hostile shapes', async () => {
    // Provider data crosses a trust boundary. An exception here aborts a sync
    // mid-flight with no status transition, which T-204 cannot then reason
    // about.
    for (const bad of [null, 42, 'string', [], { league_id: 123 }]) {
      const { http } = recordedHttp({ [`/league/${LEAGUE_ID}`]: bad })
      await expect(createSleeperProvider(http).connect(LEAGUE_ID, ctx)).resolves.toBeDefined()
    }
  })
})

describe('T-202 · 🛑 reconnecting is idempotent', () => {
  const req = { provider: 'sleeper', externalLeagueId: LEAGUE_ID, leagueId: 'l1' }
  const live: ExistingBinding = {
    id: 'b1',
    provider: 'sleeper',
    externalLeagueId: LEAGUE_ID,
    leagueId: 'l1',
    deletedAt: null,
  }

  it('creates when nothing exists', () => {
    expect(planConnect([], req).kind).toBe('create')
  })

  it('REUSES an identical live binding — no duplicate row', () => {
    const plan = planConnect([live], req)
    expect(plan.kind).toBe('reuse')
    expect(plan.kind === 'reuse' && plan.bindingId).toBe('b1')
  })

  it('🛑 and writes NO audit entry for the reuse', () => {
    // The half of the criterion that gets missed. A connect implemented as an
    // upsert produces no duplicate row and still audits every call — so an
    // operator polling their own reconnect endpoint fills the trail with events
    // describing nothing, and it becomes unreadable exactly when someone needs
    // to find a real change in it.
    expect(planShouldAudit(planConnect([live], req))).toBe(false)
    expect(planShouldAudit(planConnect([], req))).toBe(true)
  })

  it('running it twice is the same as running it once', () => {
    const first = planConnect([], req)
    expect(first.kind).toBe('create')
    // After the create, the binding exists — the second call must not create.
    const second = planConnect([live], req)
    expect(second.kind).toBe('reuse')
    expect([first, second].filter((p) => planShouldAudit(p))).toHaveLength(1)
  })

  it('REVIVES a soft-deleted binding rather than creating a second', () => {
    // The partial unique index covers live rows only, so a create WOULD
    // succeed — and would orphan the old binding's sync history.
    const plan = planConnect([{ ...live, deletedAt: new Date() }], req)
    expect(plan.kind).toBe('revive')
    expect(planShouldAudit(plan)).toBe(true)
  })

  it('🛑 CONFLICTS when the same Sleeper league is bound elsewhere', () => {
    // Silently repointing it would move a live integration under someone's
    // feet — the binding keeps syncing, into a different league.
    const plan = planConnect([{ ...live, leagueId: 'other-league' }], req)
    expect(plan.kind).toBe('conflict')
    expect(planShouldAudit(plan)).toBe(false)
  })

  it('ignores bindings for a different provider or league', () => {
    expect(planConnect([{ ...live, provider: 'yahoo' }], req).kind).toBe('create')
    expect(planConnect([{ ...live, externalLeagueId: 'other' }], req).kind).toBe('create')
  })

  it('every plan explains itself', () => {
    // This runs unattended. A plan whose reason is empty is one nobody can
    // evaluate when reconnects start behaving oddly.
    for (const existing of [[], [live], [{ ...live, deletedAt: new Date() }], [{ ...live, leagueId: 'x' }]]) {
      expect(planConnect(existing as ExistingBinding[], req).reason.length).toBeGreaterThan(20)
    }
  })
})
