/**
 * The psych profile rotation runs on the `?intel=1` tick, under its own heartbeat.
 *
 * WHY IT MOVED (measured 2026-09-12..13, the eight main-run fires after the tail reserve landed)
 * Two stopped at the 270s response deadline, three finished with the phase NOT deferred and still
 * wrote zero profiles, and the other three had writes in a window another job also writes into.
 * The rotation has no staleness floor and the engine rewrites every manager it touches, so a
 * zero-write fire did no work at all. The main run fills its 240s budget; this tick finishes its
 * own sweep in 10-23s.
 *
 * ⚠ WHAT THESE TESTS PIN, AND WHY THEY ARE BEHAVIOURAL. The failure being fixed was invisible —
 * the phase's result was persisted nowhere — so the property that matters most is that EVERY fire
 * records a heartbeat row, including one that declines for runway. A source-string check can see
 * that a heartbeat call exists; it cannot see which branch writes it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  intel: vi.fn(async () => ({ feeds: 'inside cadence' })),
  heartbeats: [] as Array<{ jobName: string; outcome: Record<string, unknown> | null; threw: boolean }>,
  remainingMs: null as number | null,
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/sports-data-importer', () => ({
  runSportsDataImporter: vi.fn(async () => {
    throw new Error('the main run must not be reached by an intel tick')
  }),
}))
vi.mock('@/lib/psychological-profiles/ProfileRefreshService', () => ({
  refreshStaleLeagueProfiles: h.refresh,
}))
vi.mock('@/lib/devy/devyIntelRefresh', () => ({ refreshDevyIntelSources: h.intel }))
vi.mock('@/lib/devy/ingestFantraxDevyAdp', () => ({
  ingestFantraxDevyAdp: vi.fn(async () => ({ priced: 0, withSchool: 0, updated: 0, unmatched: 0, ambiguous: 0, teamEntries: 0 })),
}))
vi.mock('@/lib/devy/devyHeadshotRefresh', () => ({
  refreshDevyHeadshots: vi.fn(async () => ({ refreshed: 0 })),
  refreshCollegeSportsPlayerHeadshots: vi.fn(async () => ({ refreshed: 0 })),
}))

/* Faithful to the real contract: run fn, derive the outcome from its result, record, rethrow. */
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async <T,>(
    ctx: { jobName: string },
    fn: () => Promise<T>,
    extract?: (r: T) => Record<string, unknown>,
  ): Promise<T> => {
    try {
      const result = await fn()
      h.heartbeats.push({ jobName: ctx.jobName, outcome: extract ? extract(result) : {}, threw: false })
      return result
    } catch (err) {
      h.heartbeats.push({ jobName: ctx.jobName, outcome: null, threw: true })
      throw err
    }
  },
}))

/* Real budget unless a test pins the runway. */
vi.mock('@/lib/cron/runBudget', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cron/runBudget')>('@/lib/cron/runBudget')
  return {
    ...actual,
    createRunBudget: (...args: Parameters<typeof actual.createRunBudget>) => {
      const real = actual.createRunBudget(...args)
      if (h.remainingMs == null) return real
      return { ...real, remainingMs: () => h.remainingMs as number, exhausted: () => false }
    },
  }
})

import { GET } from '@/app/api/cron/import-players/route'

const PSYCH_JOB = 'cron-psych-profile-rotation'
const intelTick = () => GET(new NextRequest('http://localhost/api/cron/import-players?intel=1'))

beforeEach(() => {
  h.refresh.mockReset()
  h.intel.mockClear()
  h.heartbeats.length = 0
  h.remainingMs = null
})

describe('the intel tick runs the psych rotation', () => {
  it('runs 24 leagues on the tick budget and returns the result', async () => {
    h.refresh.mockResolvedValue({ leaguesProfiled: 7, managersProfiled: 84, leagueIds: ['a'], stoppedEarly: true, deferred: 17 })

    const body = await (await intelTick()).json()

    expect(h.refresh).toHaveBeenCalledTimes(1)
    const arg = h.refresh.mock.calls[0][0]
    expect(arg.maxLeagues).toBe(24)
    // The budget is what stops it between leagues; without it 24 leagues could run to the edge.
    expect(typeof arg.budget?.exhausted).toBe('function')
    expect(body.mode).toBe('intel')
    expect(body.psychProfiles).toMatchObject({ leaguesProfiled: 7, stoppedEarly: true })
  })

  it('runs AFTER the intel sweep, which is the work this tick exists for', async () => {
    h.refresh.mockResolvedValue({ leaguesProfiled: 0, managersProfiled: 0, leagueIds: [], stoppedEarly: false, deferred: 0 })

    await intelTick()

    expect(h.intel.mock.invocationCallOrder[0]).toBeLessThan(h.refresh.mock.invocationCallOrder[0])
  })

  it('records its OWN heartbeat row with what it did', async () => {
    h.refresh.mockResolvedValue({ leaguesProfiled: 3, managersProfiled: 36, leagueIds: ['a', 'b', 'c'], stoppedEarly: false, deferred: 0, orphanCandidates: 2 })

    await intelTick()

    const row = h.heartbeats.find((b) => b.jobName === PSYCH_JOB)
    expect(row).toBeDefined()
    /*
     * `orphanCandidates` is here because the row is the ONLY place it surfaces: candidates whose
     * league row is gone are dropped at selection, and without this field their accumulation is
     * invisible again — which is how three of them held 3 of 24 slots for weeks.
     */
    expect(row!.outcome).toMatchObject({ rowsWritten: 36, metadata: { leaguesProfiled: 3, deferred: 0, orphanCandidates: 2 } })
    // Separate from the intel heartbeat, so one job's freshness cannot vouch for the other's.
    expect(h.heartbeats.some((b) => b.jobName === 'cron-devy-intel-sources')).toBe(true)
  })
})

describe('a short runway declines — and still leaves a record', () => {
  it('does not start the rotation below the runway floor', async () => {
    h.remainingMs = 30_000

    const body = await (await intelTick()).json()

    expect(h.refresh).not.toHaveBeenCalled()
    expect(body.psychProfiles).toMatchObject({ skipped: 'no runway', remainingMs: 30_000 })
  })

  it('writes a heartbeat row that reads as a warning, not as a healthy run', async () => {
    /*
     * 🛑 THE PROPERTY THE WHOLE MOVE IS FOR. If the runway check sat OUTSIDE the heartbeat, a tick
     * that declined every time would write nothing, and "declined" would be indistinguishable from
     * "never fired" — the invisibility that hid this phase's starvation in the first place.
     */
    h.remainingMs = 30_000

    await intelTick()

    const row = h.heartbeats.find((b) => b.jobName === PSYCH_JOB)
    expect(row).toBeDefined()
    expect((row!.outcome?.warnings as string[] | undefined)?.[0]).toMatch(/no runway/)
  })
})

describe('a failing rotation cannot take the intel tick down with it', () => {
  it('reports the error and still returns the intel outcome', async () => {
    h.refresh.mockRejectedValue(new Error('sleeper said no'))

    const res = await intelTick()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.devyIntelSources).toEqual({ feeds: 'inside cadence' })
    expect(body.psychProfiles).toEqual({ error: 'sleeper said no' })
    expect(h.heartbeats.find((b) => b.jobName === PSYCH_JOB)?.threw).toBe(true)
  })
})

describe('the main run no longer carries the phase', () => {
  const SRC = readFileSync(join(process.cwd(), 'app/api/cron/import-players/route.ts'), 'utf8')
  // Comments stripped: this file's own doc blocks name the call they describe.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('calls the rotation exactly once, and only inside the intel block', () => {
    const calls = CODE.match(/refreshStaleLeagueProfiles\(/g) ?? []
    expect(calls).toHaveLength(1)

    const at = CODE.indexOf('refreshStaleLeagueProfiles(')
    expect(at).toBeGreaterThan(CODE.indexOf('if (intelOnly)'))
    expect(at).toBeLessThan(CODE.indexOf("mode: 'intel'"))
  })

  it('no longer defers a psych phase in the main run', () => {
    expect(CODE).not.toMatch(/deferredPhases\.push\(['"]psychProfiles['"]\)/)
  })
})
