/**
 * Commissioner OS · T-204 acceptance.
 *
 * "A simulated provider failure moves the league to DEGRADED, writes depending
 * on external state are refused with a typed error, and the state is exposed on
 * the API (assert on the state field — no UI in this handoff's scope)."
 *
 * Plus the case the acceptance does not name and the ticket does: a provider
 * going dark. That produces ZERO failures, so a failure counter never moves —
 * and it is the failure mode "never stale-as-live" is actually about.
 */

import { describe, it, expect } from 'vitest'
import {
  DEGRADE_AFTER_FAILURES,
  EXTERNALLY_DEPENDENT_ACTIONS,
  FRESHNESS_WINDOW_MS,
  type BindingSyncState,
  applyOutcome,
  degradedReason,
  dependsOnExternalState,
  effectiveStatus,
  guardExternalWrite,
  isDegraded,
  syncHealthView,
} from '@/lib/domain/syncHealth'
import { providerError } from '@/lib/domain/providers'
import { PERMISSION_MATRIX } from '@/lib/domain/authorize'
import { toHttpResponse } from '@/lib/domain/errors'

const NOW = new Date('2026-08-31T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

const healthy = (over: Partial<BindingSyncState> = {}): BindingSyncState => ({
  status: 'OK',
  consecutiveFailures: 0,
  lastSyncedAt: ago(60_000),
  lastErrorAt: null,
  lastErrorSummary: null,
  ...over,
})

const fail = (summary = 'Provider returned 503.') =>
  ({ kind: 'failure', at: NOW, error: providerError('UNAVAILABLE', summary) }) as const

describe('T-204 · 🛑 a simulated provider failure moves the league to DEGRADED', () => {
  it('one failure is FAILED, not DEGRADED', () => {
    // FAILED describes ONE job; DEGRADED describes a league in a bad state.
    // Conflating them means a single 503 flags the league to the operator, and
    // they stop believing the flag.
    const s = applyOutcome(healthy(), fail())
    expect(s.status).toBe('FAILED')
    expect(s.consecutiveFailures).toBe(1)
  })

  it('reaches DEGRADED at the threshold', () => {
    let s = healthy()
    for (let i = 0; i < DEGRADE_AFTER_FAILURES; i++) s = applyOutcome(s, fail())
    expect(s.status).toBe('DEGRADED')
    expect(s.consecutiveFailures).toBe(DEGRADE_AFTER_FAILURES)
  })

  it('is not degraded one failure short', () => {
    let s = healthy()
    for (let i = 0; i < DEGRADE_AFTER_FAILURES - 1; i++) s = applyOutcome(s, fail())
    expect(s.status).not.toBe('DEGRADED')
  })

  it('🛑 a success RESETS the counter to zero, not decrements it', () => {
    // A provider that flaps — fail, fail, succeed, fail, fail — is healthy
    // enough to use. Decrementing would accumulate flapping into a DEGRADED
    // that never clears.
    let s = healthy()
    s = applyOutcome(s, fail())
    s = applyOutcome(s, fail())
    s = applyOutcome(s, { kind: 'success', at: NOW })
    expect(s.consecutiveFailures).toBe(0)
    expect(s.status).toBe('OK')

    s = applyOutcome(s, fail())
    s = applyOutcome(s, fail())
    expect(s.status).not.toBe('DEGRADED')
  })

  it('recovers from DEGRADED on one success', () => {
    let s = healthy()
    for (let i = 0; i < DEGRADE_AFTER_FAILURES; i++) s = applyOutcome(s, fail())
    expect(s.status).toBe('DEGRADED')
    s = applyOutcome(s, { kind: 'success', at: NOW })
    expect(s.status).toBe('OK')
    expect(s.lastErrorSummary).toBeNull()
  })

  it('stores the SUMMARY, never a raw provider error', () => {
    // A provider error routinely embeds the request URL, and the root CLAUDE.md
    // records that Rolling Insights passes its token as a query parameter.
    const s = applyOutcome(healthy(), fail('Provider returned 503.'))
    expect(s.lastErrorSummary).toBe('Provider returned 503.')
    expect(s.lastErrorSummary).not.toMatch(/https?:\/\//)
  })

  it('a failure does not move lastSyncedAt', () => {
    // Otherwise a failing sync refreshes its own freshness stamp and the
    // staleness check below can never fire — the two guards would cancel out.
    const before = healthy()
    const after = applyOutcome(before, fail())
    expect(after.lastSyncedAt).toEqual(before.lastSyncedAt)
  })
})

describe('T-204 · 🛑 a provider going dark — the case a failure counter cannot see', () => {
  it('stale-but-OK reads as DEGRADED', () => {
    // THE TICKET'S ACTUAL SUBJECT. "Assume a provider goes dark mid-season."
    // No jobs run, so there are ZERO failures and the counter never moves.
    // A stored-column implementation shows OK forever while the data ages, and
    // the product serves a January roster in March with a green badge on it.
    const stale = healthy({ lastSyncedAt: ago(FRESHNESS_WINDOW_MS + 1) })
    expect(stale.status).toBe('OK')
    expect(stale.consecutiveFailures).toBe(0)
    expect(effectiveStatus(stale, NOW)).toBe('DEGRADED')
  })

  it('fresh-and-OK stays OK (positive control)', () => {
    // Without this, effectiveStatus could return DEGRADED unconditionally and
    // every assertion above would pass on a component that flags everything.
    expect(effectiveStatus(healthy(), NOW)).toBe('OK')
  })

  it('is OK right up to the window edge', () => {
    expect(effectiveStatus(healthy({ lastSyncedAt: ago(FRESHNESS_WINDOW_MS) }), NOW)).toBe('OK')
    expect(effectiveStatus(healthy({ lastSyncedAt: ago(FRESHNESS_WINDOW_MS + 1) }), NOW)).toBe(
      'DEGRADED',
    )
  })

  it('a binding that has NEVER synced is IDLE, not OK', () => {
    // Created and never run is not healthy, it is unproven — and reporting OK
    // for it would be the same lie in a different tense.
    expect(effectiveStatus(healthy({ lastSyncedAt: null }), NOW)).toBe('IDLE')
  })

  it('the freshness window is generous on purpose', () => {
    // A false DEGRADED on a provider having a slow morning teaches operators to
    // ignore the flag, and a flag nobody reads is worse than none. The failure
    // this defends against is measured in days.
    expect(FRESHNESS_WINDOW_MS).toBeGreaterThanOrEqual(4 * 60 * 60 * 1000)
  })

  it('says STALE rather than "failed", because they need different answers', () => {
    const reason = degradedReason(healthy({ lastSyncedAt: ago(FRESHNESS_WINDOW_MS * 2) }), NOW)
    expect(reason).toMatch(/not synced for \d+ hours/)
    expect(reason).not.toMatch(/failed/i)
  })

  it('says FAILED when it actually failed', () => {
    let s = healthy()
    for (let i = 0; i < DEGRADE_AFTER_FAILURES; i++) s = applyOutcome(s, fail('Provider returned 503.'))
    expect(degradedReason(s, NOW)).toMatch(/failed .* times in a row/)
    expect(degradedReason(s, NOW)).toContain('503')
  })

  it('a healthy binding has no reason at all', () => {
    expect(degradedReason(healthy(), NOW)).toBeNull()
    expect(isDegraded(healthy(), NOW)).toBe(false)
  })
})

describe('T-204 · writes depending on external state are refused with a typed error', () => {
  const degraded = () => {
    let s = healthy()
    for (let i = 0; i < DEGRADE_AFTER_FAILURES; i++) s = applyOutcome(s, fail())
    return s
  }

  it('🛑 refuses an externally-dependent action when degraded', () => {
    const r = guardExternalWrite('league.phase.advance', degraded(), NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INVARIANT')
    expect(r.error).toMatchObject({ invariant: 'sync.degraded' })
  })

  it('refuses when merely STALE, not only when failing', () => {
    // The same guard has to cover the dark-provider case, or the read-only
    // behaviour applies to the failure everyone anticipated and not to the one
    // that actually happens.
    const r = guardExternalWrite(
      'league.sync.reconcile',
      healthy({ lastSyncedAt: ago(FRESHNESS_WINDOW_MS * 3) }),
      NOW,
    )
    expect(r.ok).toBe(false)
  })

  it('the refusal explains itself and names the action', () => {
    // CLAUDE.md: "refusals that explain themselves". An operator needs to know
    // whether it broke or stopped, and what to do.
    const r = guardExternalWrite('league.phase.advance', degraded(), NOW)
    if (r.ok) throw new Error('expected refusal')
    expect(r.error.detail).toContain('league.phase.advance')
    expect(r.error.detail).toMatch(/Reads and export are unaffected/)
  })

  it('maps to a 422 the caller can act on', () => {
    const r = guardExternalWrite('league.phase.advance', degraded(), NOW)
    if (r.ok) throw new Error('expected refusal')
    const res = toHttpResponse(r.error)
    expect(res.status).toBe(422)
    expect(res.body.error.details).toMatchObject({ invariant: 'sync.degraded' })
  })

  it('🛑 allows everything NOT dependent on external state', () => {
    // A degraded league must stay usable. Freezing every write would turn a
    // provider outage into an outage of our own product — the opposite of
    // graceful.
    for (const action of ['league.settings.update', 'audit.read', 'tenant.export'] as const) {
      expect(guardExternalWrite(action, degraded(), NOW).ok, action).toBe(true)
    }
  })

  it('allows externally-dependent actions when healthy', () => {
    for (const action of EXTERNALLY_DEPENDENT_ACTIONS) {
      expect(guardExternalWrite(action, healthy(), NOW).ok, action).toBe(true)
    }
  })

  it('the dependent list is short and every entry is a real action', () => {
    expect(EXTERNALLY_DEPENDENT_ACTIONS.length).toBeGreaterThan(0)
    expect(EXTERNALLY_DEPENDENT_ACTIONS.length).toBeLessThan(5)
    for (const a of EXTERNALLY_DEPENDENT_ACTIONS) {
      expect(PERMISSION_MATRIX[a], `${a} is not in the matrix`).toBeDefined()
      // Every one is a WRITE. A read that depends on stale data should show the
      // staleness, not refuse — refusing reads is how an operator loses the
      // ability to see what went wrong.
      expect(PERMISSION_MATRIX[a].write, `${a} is not a write`).toBe(true)
    }
  })

  it('reads are never in the dependent list', () => {
    expect(dependsOnExternalState('audit.read')).toBe(false)
    expect(dependsOnExternalState('analytics.read')).toBe(false)
    expect(dependsOnExternalState('tenant.export')).toBe(false)
  })
})

describe('T-204 · the state is exposed on the API', () => {
  const binding = (state: BindingSyncState) => ({ id: 'b1', provider: 'sleeper', ...state })

  it('reports the state field for a healthy binding', () => {
    const v = syncHealthView(binding(healthy()), NOW)
    expect(v.status).toBe('OK')
    expect(v.degraded).toBe(false)
    expect(v.reason).toBeNull()
    expect(v.blockedActions).toEqual([])
  })

  it('🛑 reports DERIVED status, not the stored column', () => {
    // The point of the whole module. A projection returning `binding.status`
    // would show OK for a league whose provider went dark in January —
    // "stale-as-live", in exactly the words the ticket forbids.
    const stale = healthy({ lastSyncedAt: ago(FRESHNESS_WINDOW_MS * 4) })
    expect(stale.status).toBe('OK')
    const v = syncHealthView(binding(stale), NOW)
    expect(v.status).toBe('DEGRADED')
    expect(v.degraded).toBe(true)
  })

  it('tells the caller what is blocked, so a UI need not re-derive it', () => {
    let s = healthy()
    for (let i = 0; i < DEGRADE_AFTER_FAILURES; i++) s = applyOutcome(s, fail())
    const v = syncHealthView(binding(s), NOW)
    expect(v.blockedActions).toEqual(EXTERNALLY_DEPENDENT_ACTIONS)
    expect(v.reason).toBeTruthy()
  })

  it('survives JSON serialization', () => {
    // It crosses a route boundary. A Date that does not round-trip reaches the
    // client as something other than what was asserted here.
    const v = syncHealthView(binding(healthy()), NOW)
    expect(JSON.parse(JSON.stringify(v))).toEqual(v)
    expect(typeof v.lastSyncedAt).toBe('string')
  })

  it('reports null rather than omitting lastSyncedAt for a never-synced binding', () => {
    const v = syncHealthView(binding(healthy({ lastSyncedAt: null })), NOW)
    expect(v.lastSyncedAt).toBeNull()
    expect(v.status).toBe('IDLE')
  })

  it('exposes the failure count, so "how bad" is answerable', () => {
    let s = healthy()
    for (let i = 0; i < DEGRADE_AFTER_FAILURES + 2; i++) s = applyOutcome(s, fail())
    expect(syncHealthView(binding(s), NOW).consecutiveFailures).toBe(DEGRADE_AFTER_FAILURES + 2)
  })
})
