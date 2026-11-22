/**
 * The Sleeper trade-fact rotation runs on the `?intel=1` tick, under its own heartbeat.
 *
 * Until 2026-11-19 this file pinned the psych PROFILE rotation, which ran here. That engine was retired
 * (re-score build item 10), but its prelude — normalise trade history, then ingest each picked league's
 * Sleeper trades — was the only scheduled writer of Sleeper trades after import, so it stayed as its own
 * phase (`lib/league-import/sleeper/sleeperTradeFactRotation.ts`). The tick placement, the runway floor and
 * the "every fire leaves a heartbeat row" property all carry over, and so do these tests.
 *
 * WHY IT IS ON THIS TICK (measured 2026-09-12..13 for the profile rotation): the main run fills its 240s
 * budget; this tick finishes its own sweep in 10-23s.
 *
 * ⚠ WHAT THESE TESTS PIN, AND WHY THEY ARE BEHAVIOURAL. The property that matters most is that EVERY fire
 * records a heartbeat row, including one that declines for runway. A source-string check can see that a
 * heartbeat call exists; it cannot see which branch writes it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  intel: vi.fn(async () => ({ feeds: 'inside cadence' })),
  espnSeason: vi.fn(() => true),
  espnTeamMap: vi.fn(async () => ({ skipped: 'fresh', unmatched: [] as string[] })),
  espnRosters: vi.fn(async (_opts: { deadlineAt: number }) => ({ blocked: false, identitiesCreated: 2, headshotsWritten: 3, errors: 0 })),
  collegePool: vi.fn(async () => ({ candidates: 0, created: 0, updated: 0, skipped: 0, ambiguous: 0 })),
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
vi.mock('@/lib/league-import/sleeper/sleeperTradeFactRotation', () => ({
  rotateSleeperTradeFacts: h.refresh,
}))
vi.mock('@/lib/devy/devyIntelRefresh', () => ({ refreshDevyIntelSources: h.intel }))
vi.mock('@/lib/devy/ingestFantraxDevyAdp', () => ({
  ingestFantraxDevyAdp: vi.fn(async () => ({ priced: 0, withSchool: 0, updated: 0, unmatched: 0, ambiguous: 0, teamEntries: 0 })),
}))
vi.mock('@/lib/devy/devyHeadshotRefresh', () => ({
  refreshDevyHeadshots: vi.fn(async () => ({ refreshed: 0 })),
  refreshCollegeSportsPlayerHeadshots: vi.fn(async () => ({ refreshed: 0 })),
}))
/* The ESPN NCAAB phase shares this tick. Mocked so the real module (prisma + ESPN) never runs here. */
vi.mock('@/lib/espn/ncaabEspnIngest', () => ({
  isNcaabRosterSeason: h.espnSeason,
  syncEspnNcaabTeamMapIfDue: h.espnTeamMap,
  syncEspnNcaabRosters: h.espnRosters,
}))

vi.mock('@/lib/devy/ncaabRosterPool', () => ({ materializeNcaabRosterPool: h.collegePool }))

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

const JOB = 'cron-sleeper-trade-facts'
const intelTick = () => GET(new NextRequest('http://localhost/api/cron/import-players?intel=1'))

beforeEach(() => {
  h.refresh.mockReset()
  h.intel.mockClear()
  h.espnSeason.mockClear().mockReturnValue(true)
  h.espnTeamMap.mockClear()
  h.espnRosters.mockClear()
  h.collegePool.mockClear()
  h.heartbeats.length = 0
  h.remainingMs = null
})

describe('the intel tick runs the Sleeper trade-fact rotation', () => {
  it('runs once and returns its result', async () => {
    h.refresh.mockResolvedValue({ sleeperLeagues: 550, picked: 24, slot: 81_000, historyFactsWritten: 4, ingest: { factsWritten: 9, rateLimited: 0 }, errors: [] })

    const body = await (await intelTick()).json()

    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(body.mode).toBe('intel')
    expect(body.sleeperTradeFacts).toMatchObject({ picked: 24, historyFactsWritten: 4 })
    // The profile phase is gone from the response, not left as a stub.
    expect(body).not.toHaveProperty('psychProfiles')
  })

  it('runs AFTER the intel sweep, which is the work this tick exists for', async () => {
    h.refresh.mockResolvedValue({ sleeperLeagues: 0, picked: 0, slot: 1, historyFactsWritten: null, ingest: null, errors: [] })

    await intelTick()

    expect(h.intel.mock.invocationCallOrder[0]).toBeLessThan(h.refresh.mock.invocationCallOrder[0])
  })

  it('records its OWN heartbeat row with what it wrote', async () => {
    h.refresh.mockResolvedValue({ sleeperLeagues: 550, picked: 24, slot: 81_000, historyFactsWritten: 4, ingest: { factsWritten: 9, rateLimited: 0 }, errors: [] })

    await intelTick()

    const row = h.heartbeats.find((b) => b.jobName === JOB)
    expect(row).toBeDefined()
    expect(row!.outcome).toMatchObject({ rowsWritten: 13, metadata: { picked: 24, ingestFactsWritten: 9, rateLimited: 0 } })
    // Separate from the intel heartbeat, so one job's freshness cannot vouch for the other's.
    expect(h.heartbeats.some((b) => b.jobName === 'cron-devy-intel-sources')).toBe(true)
    // The profile rotation's heartbeat stops with it.
    expect(h.heartbeats.some((b) => b.jobName === 'cron-psych-profile-rotation')).toBe(false)
  })
})

describe('a short runway declines — and still leaves a record', () => {
  it('does not start the rotation below the runway floor', async () => {
    h.remainingMs = 30_000

    const body = await (await intelTick()).json()

    expect(h.refresh).not.toHaveBeenCalled()
    expect(body.sleeperTradeFacts).toMatchObject({ skipped: 'no runway', remainingMs: 30_000 })
  })

  it('writes a heartbeat row that reads as a warning, not as a healthy run', async () => {
    /*
     * 🛑 THE PROPERTY THE WHOLE MOVE IS FOR. If the runway check sat OUTSIDE the heartbeat, a tick
     * that declined every time would write nothing, and "declined" would be indistinguishable from
     * "never fired" — the invisibility that hid this phase's starvation in the first place.
     */
    h.remainingMs = 30_000

    await intelTick()

    const row = h.heartbeats.find((b) => b.jobName === JOB)
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
    expect(body.sleeperTradeFacts).toEqual({ error: 'sleeper said no' })
    expect(h.heartbeats.find((b) => b.jobName === JOB)?.threw).toBe(true)
  })
})

describe('the ESPN college basketball phase shares the tick without starving the rotation', () => {
  const ESPN_JOB = 'cron-espn-ncaab-rosters'
  const settled = () =>
    h.refresh.mockResolvedValue({ sleeperLeagues: 0, picked: 0, slot: 1, historyFactsWritten: null, ingest: null, errors: [] })

  it('runs before the rotation, under its own heartbeat, and reports what it wrote', async () => {
    settled()
    const body = await (await intelTick()).json()

    expect(h.espnRosters).toHaveBeenCalledTimes(1)
    expect(h.collegePool).toHaveBeenCalledTimes(1)
    expect(h.espnRosters.mock.invocationCallOrder[0]).toBeLessThan(h.collegePool.mock.invocationCallOrder[0])
    expect(h.collegePool.mock.invocationCallOrder[0]).toBeLessThan(h.refresh.mock.invocationCallOrder[0])
    expect(body.espnNcaab).toMatchObject({ rosters: { identitiesCreated: 2, headshotsWritten: 3 } })
    expect(h.heartbeats.find((b) => b.jobName === ESPN_JOB)?.outcome).toMatchObject({ rowsWritten: 5 })
  })

  it('takes at most 45s, and never the trade-fact runway beneath it', async () => {
    settled()
    h.remainingMs = 120_000 // 120s left: the rotation needs 90s, so ESPN may have 30s
    const before = Date.now()
    await intelTick()

    const { deadlineAt } = h.espnRosters.mock.calls[0]![0]
    expect(deadlineAt - before).toBeLessThanOrEqual(30_000 + 1_000)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('declines below its own minimum, leaves a warning row, and the rotation still runs', async () => {
    settled()
    h.remainingMs = 100_000 // 100 - 90 = 10s, under the 15s minimum
    const body = await (await intelTick()).json()

    expect(h.espnRosters).not.toHaveBeenCalled()
    expect(body.espnNcaab).toMatchObject({ skipped: 'no runway' })
    expect((h.heartbeats.find((b) => b.jobName === ESPN_JOB)?.outcome?.warnings as string[])[0]).toMatch(/no runway/)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing out of season, and that is not a warning', async () => {
    settled()
    h.espnSeason.mockReturnValue(false)
    const body = await (await intelTick()).json()

    expect(h.espnTeamMap).not.toHaveBeenCalled()
    expect(h.espnRosters).not.toHaveBeenCalled()
    expect(body.espnNcaab).toEqual({ skipped: 'out of season' })
    expect(h.heartbeats.find((b) => b.jobName === ESPN_JOB)?.outcome?.warnings).toEqual([])
  })
})

describe('the main run does not carry the phase, and the profile rotation is gone', () => {
  const SRC = readFileSync(join(process.cwd(), 'app/api/cron/import-players/route.ts'), 'utf8')
  // Comments stripped: this file's own doc blocks name the call they describe.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('calls the rotation exactly once, and only inside the intel block', () => {
    const calls = CODE.match(/rotateSleeperTradeFacts\(/g) ?? []
    expect(calls).toHaveLength(1)

    const at = CODE.indexOf('rotateSleeperTradeFacts(')
    expect(at).toBeGreaterThan(CODE.indexOf('if (intelOnly)'))
    expect(at).toBeLessThan(CODE.indexOf("mode: 'intel'"))
  })

  it('no longer profiles managers anywhere in the cron', () => {
    expect(CODE).not.toMatch(/refreshStaleLeagueProfiles|psychological-profiles\/ProfileRefreshService/)
    expect(CODE).not.toMatch(/deferredPhases\.push\(['"]psychProfiles['"]\)/)
  })
})
