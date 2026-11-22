// @vitest-environment node
/**
 * The Decision OS background cron (route-level, no database).
 *
 * Its three-brain maintenance step — behind `DECISION_OS_MAINTENANCE_ENABLED` — was RETIRED 2026-11-19 (re-score
 * build item 9): nothing ever produced a three-brain run, and every reader of a saved analysis went in the same
 * change. The runner and its deps factory stay MOCKED here on purpose: the route no longer imports them, and the
 * assertions that they are never called are what fail if anyone wires the step back without a decision to.
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

// The tick heartbeat (2026-09-30) — added with its mock, per the note above.
const recordRunMock = vi.fn(async () => undefined)
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  recordSyncJobRun: (...args: unknown[]) => recordRunMock(...args),
}))

import { GET } from '@/app/api/cron/decision-os-intelligence-maintenance/route'
import { PROBES } from '../../scripts/cron-freshness-check.mjs'

const SECRET = 'test-cron-secret'
const ENV_KEYS = ['CRON_SECRET', 'DECISION_OS_MAINTENANCE_ENABLED', 'DECISION_OS_SHADOW_SWEEP_ENABLED'] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  runMock.mockClear()
  depsMock.mockClear()
  adviceLearningMock.mockClear()
  recordRunMock.mockClear()
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

describe('decision-os maintenance cron — the three-brain step is retired', () => {
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

  it('3. authorized → 200; the three-brain runner is never reached, whatever DECISION_OS_MAINTENANCE_ENABLED says', async () => {
    for (const v of [undefined, 'false', 'true', '1', 'yes']) {
      if (v === undefined) delete process.env.DECISION_OS_MAINTENANCE_ENABLED
      else process.env.DECISION_OS_MAINTENANCE_ENABLED = v
      const res = await GET(authed())
      expect(res.status, `value=${JSON.stringify(v)}`).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      // No maintenance envelope any more: nothing ran to report.
      expect(body).not.toHaveProperty('tickId')
      expect(body).not.toHaveProperty('enabled')
    }
    expect(runMock).not.toHaveBeenCalled()
    expect(depsMock).not.toHaveBeenCalled()
    // The cron's other work still runs on every authorized tick.
    expect(adviceLearningMock).toHaveBeenCalledTimes(5)
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

/*
 * Owner decision 2026-09-29: the duplicate Decision OS lineup engine is retired — /core My Team is
 * the one start/sit answer. This cron used to run its shadow sweep every ten minutes behind
 * `DECISION_OS_SHADOW_SWEEP_ENABLED`, which `.env.production` set to "true" until 2026-09-30 (a
 * Railway/dashboard value may still). The flag is set HERE on purpose: the retirement has to hold
 * with the old switch still on, because nobody is going to remember to turn it off everywhere.
 */
describe('decision-os maintenance cron — lineup shadow sweep is retired', () => {
  for (const maintenance of ['true', 'false']) {
    it(`runs no lineup sweep even with DECISION_OS_SHADOW_SWEEP_ENABLED=true (maintenance=${maintenance})`, async () => {
      process.env.DECISION_OS_SHADOW_SWEEP_ENABLED = 'true'
      process.env.DECISION_OS_MAINTENANCE_ENABLED = maintenance
      const res = await GET(authed())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).not.toHaveProperty('sweep')
    })
  }
})

/*
 * The freshness probe for this route read `decision_parity_record`, whose steady writer was the
 * lineup sweep retired above. From 21:53Z on 2026-09-29 it read STALE hourly while the route fired
 * every ten minutes. It now reads this heartbeat, so every authorized tick must record one.
 */
describe('decision-os maintenance cron — tick heartbeat', () => {
  const jobName = () =>
    (PROBES as Record<string, { heartbeat?: string }>)['/api/cron/decision-os-intelligence-maintenance']!.heartbeat

  for (const maintenance of ['true', 'false']) {
    it(`records one heartbeat per authorized tick, named as the probe expects (maintenance=${maintenance})`, async () => {
      process.env.DECISION_OS_MAINTENANCE_ENABLED = maintenance
      await GET(authed())
      expect(recordRunMock).toHaveBeenCalledTimes(1)
      const [ctx, outcome] = recordRunMock.mock.calls[0] as [{ jobName: string }, { errors?: string[]; warnings: string[] }]
      expect(ctx.jobName).toBe(jobName())
      expect(outcome.errors ?? []).toEqual([])
      expect(outcome.warnings).toEqual([])
    })
  }

  it('records nothing for an unauthorized caller', async () => {
    await GET(req())
    expect(recordRunMock).not.toHaveBeenCalled()
  })

  it('records a caught advice-rebuild failure as a warning (partial), not a failure', async () => {
    adviceLearningMock.mockRejectedValueOnce(new Error('db down'))
    await GET(authed())
    const [, outcome] = recordRunMock.mock.calls[0] as [unknown, { errors?: string[]; warnings: string[] }]
    expect(outcome.warnings).toEqual(['adviceLearning: db down'])
    expect(outcome.errors ?? []).toEqual([])
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
