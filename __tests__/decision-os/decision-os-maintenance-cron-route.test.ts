// @vitest-environment node
/**
 * Phase 2.55 — maintenance cron ACTIVATION GATE (route-level, no database).
 *
 * Proves the off-by-default `DECISION_OS_MAINTENANCE_ENABLED` gate: authentication runs first (401 stands even
 * when disabled), and an authenticated-but-disabled request is fully inert — the maintenance runner and the
 * production deps factory (the ONLY paths to any DB / provider / token / freshness work) are never invoked.
 * Both are mocked, so this test needs no database and makes no paid provider call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const runMock = vi.fn(async () => ({ status: 'completed' as const, results: {} }))
const depsMock = vi.fn(() => ({}) as never)

// Mock exactly what the route imports, so the real (prisma-backed, server-only) modules never load.
vi.mock('@/lib/decision-os/three-brain/phase2/maintenanceRunner', () => ({
  runIntelligenceMaintenance: (...args: unknown[]) => runMock(...args),
}))
vi.mock('@/lib/decision-os/three-brain/phase2/realAdapters', () => ({
  createManagedIntelligenceDeps: (...args: unknown[]) => depsMock(...args),
}))
/*
 * ⚠ THIS MOCK WAS MISSING FOR A WEEK OF "Mock exactly what the route imports". PR #905 added the
 * draft-outcome resolver to this route, ABOVE the maintenance gate, and did not add it here — so
 * every authorized case ran the real prisma read against the test sentinel (`127.0.0.1:1`),
 * retried, and 4b (five values in one test) blew the 30s timeout. Its late runner call then
 * landed in test 5's count ("called 2 times"). Found 2026-09-16 by the author of #905.
 */
const resolveOutcomesMock = vi.fn(async () => ({
  examined: 0,
  resolved: 0,
  followed: 0,
  ignored: 0,
  pendingNoPickYet: 0,
  skippedNonDecision: 0,
  skippedUnusable: 0,
}))
vi.mock('@/lib/ai/outcomes/resolveDraftRecommendationOutcomes', () => ({
  resolveDraftRecommendationOutcomes: (...args: unknown[]) => resolveOutcomesMock(...args),
}))
// The outcome loop's rebuild (Chimmy item 10) — added with its mock, per the note above.
const adviceLearningMock = vi.fn(async () => ({ status: 'fresh' as const, computedAt: '2026-09-16T00:00:00.000Z' }))
vi.mock('@/lib/chimmy-outcomes/adviceLearning', () => ({
  recomputeAdviceLearning: (...args: unknown[]) => adviceLearningMock(...args),
}))

import { GET } from '@/app/api/cron/decision-os-intelligence-maintenance/route'

const SECRET = 'test-cron-secret'
const ENV_KEYS = ['CRON_SECRET', 'DECISION_OS_MAINTENANCE_ENABLED'] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  runMock.mockClear()
  depsMock.mockClear()
  adviceLearningMock.mockClear()
  process.env.CRON_SECRET = SECRET
  delete process.env.DECISION_OS_MAINTENANCE_ENABLED
})
afterEach(() => {
  // Restore env exactly so no test contaminates another.
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const URL_STR = 'https://af.test/api/cron/decision-os-intelligence-maintenance'
const req = (opts: { auth?: string } = {}) => {
  const headers = new Headers()
  if (opts.auth) headers.set('authorization', opts.auth)
  return new Request(URL_STR, { headers })
}
const authed = () => req({ auth: `Bearer ${SECRET}` })

describe('decision-os maintenance cron — activation gate', () => {
  it('1. unauthorized + disabled → 401; runner + deps never touched', async () => {
    delete process.env.DECISION_OS_MAINTENANCE_ENABLED
    const res = await GET(req()) // no Authorization header
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ ok: false })
    expect(runMock).not.toHaveBeenCalled()
    expect(depsMock).not.toHaveBeenCalled()
  })

  it('2. unauthorized + enabled → 401 (auth runs BEFORE the gate); runner + deps never touched', async () => {
    process.env.DECISION_OS_MAINTENANCE_ENABLED = 'true'
    const res = await GET(req({ auth: 'Bearer wrong-secret' }))
    expect(res.status).toBe(401)
    expect(runMock).not.toHaveBeenCalled()
    expect(depsMock).not.toHaveBeenCalled()
  })

  it('3. authorized + MISSING flag → disabled inert response', async () => {
    delete process.env.DECISION_OS_MAINTENANCE_ENABLED
    const res = await GET(authed())
    expect(res.status).toBe(200)
    const body = await res.json()
    // The route now carries a SECOND, independently gated feature (the lineup shadow sweep), so
    // this asserts the maintenance contract rather than the whole envelope. `toEqual` on the
    // envelope made an unrelated additive field a failure, which is what happened here.
    expect(body).toMatchObject({ ok: true, enabled: false, status: 'maintenance_disabled' })
    // Inertness is the actual guarantee, and it is stronger asserted directly:
    expect(body.sweep?.ran).toBe(false)
    expect(runMock).not.toHaveBeenCalled()
    expect(depsMock).not.toHaveBeenCalled()
  })

  it('4. authorized + "false" → disabled inert response', async () => {
    process.env.DECISION_OS_MAINTENANCE_ENABLED = 'false'
    const res = await GET(authed())
    expect(res.status).toBe(200)
    const body = await res.json()
    // The route now carries a SECOND, independently gated feature (the lineup shadow sweep), so
    // this asserts the maintenance contract rather than the whole envelope. `toEqual` on the
    // envelope made an unrelated additive field a failure, which is what happened here.
    expect(body).toMatchObject({ ok: true, enabled: false, status: 'maintenance_disabled' })
    // Inertness is the actual guarantee, and it is stronger asserted directly:
    expect(body.sweep?.ran).toBe(false)
    expect(runMock).not.toHaveBeenCalled()
    expect(depsMock).not.toHaveBeenCalled()
  })

  it('4b. authorized + any non-exact-"true" value ("1","yes","TRUE","","enabled") → disabled', async () => {
    for (const v of ['1', 'yes', 'TRUE', '', 'enabled', ' true ']) {
      process.env.DECISION_OS_MAINTENANCE_ENABLED = v
      const res = await GET(authed())
      expect(await res.json(), `value=${JSON.stringify(v)} must be disabled`).toMatchObject({
        ok: true,
        enabled: false,
        status: 'maintenance_disabled',
      })
    }
    expect(runMock).not.toHaveBeenCalled()
    expect(depsMock).not.toHaveBeenCalled()
  })

  it('5. authorized + EXACTLY "true" → reaches the maintenance runner (deps built once, runner invoked once)', async () => {
    process.env.DECISION_OS_MAINTENANCE_ENABLED = 'true'
    const res = await GET(authed())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, enabled: true })
    expect(depsMock).toHaveBeenCalledTimes(1)
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it('6/7. disabled path performs ZERO runner/deps work (the only route to DB/providers/tokens) — no paid calls possible', async () => {
    process.env.DECISION_OS_MAINTENANCE_ENABLED = 'false'
    await GET(authed())
    delete process.env.DECISION_OS_MAINTENANCE_ENABLED
    await GET(authed())
    expect(runMock).not.toHaveBeenCalled() // runner (→ drains/reconcile/providers) never called
    expect(depsMock).not.toHaveBeenCalled() // real prisma-backed deps never even constructed
  })
})

describe('decision-os maintenance cron — Chimmy outcome loop', () => {
  it('rebuilds whether or not maintenance is enabled, and reports it', async () => {
    delete process.env.DECISION_OS_MAINTENANCE_ENABLED
    const off = await (await GET(authed())).json()
    process.env.DECISION_OS_MAINTENANCE_ENABLED = 'true'
    const on = await (await GET(authed())).json()
    expect(adviceLearningMock).toHaveBeenCalledTimes(2)
    expect(off.adviceLearning).toEqual({ status: 'fresh', computedAt: '2026-09-16T00:00:00.000Z' })
    expect(on.adviceLearning).toEqual({ status: 'fresh', computedAt: '2026-09-16T00:00:00.000Z' })
  })

  it('never runs for an unauthorized caller', async () => {
    await GET(req())
    expect(adviceLearningMock).not.toHaveBeenCalled()
  })

  it('a failed rebuild is reported, not thrown', async () => {
    adviceLearningMock.mockRejectedValueOnce(new Error('db down'))
    const res = await GET(authed())
    expect(res.status).toBe(200)
    expect((await res.json()).adviceLearning).toEqual({ status: 'error', error: 'db down' })
  })
})
