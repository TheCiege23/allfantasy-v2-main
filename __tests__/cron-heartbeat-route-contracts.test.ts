/**
 * Heartbeat contract tests for the three cron routes that were REFACTORED, not merely wrapped,
 * when `withSyncJobRun` was added to the conditional crons (#581).
 *
 * WHY THESE THREE
 * `waivers` grew `discoverOrExplain` + `sweepDueWaiverLeagues`, `refresh-schedule` grew
 * `refreshActiveChallenges`, and `tournament/automation` changed `runAutomation` from returning a
 * `NextResponse` to returning plain data. All three are in-season code paths: it is August, they
 * legitimately do nothing right now, and a mistake in them would not surface until live scoring.
 * Two of the three had no test file of any kind.
 *
 * WHAT IS PINNED, and why each one is the thing that would actually break:
 *
 *   1. THE NO-WORK RUN STILL RECORDS A HEARTBEAT. This is the entire premise. These jobs write
 *      nothing most of the year, so the freshness monitor probes `max(started_at)` in
 *      sync_job_runs rather than an output table. If a refactor moved the wrap below an
 *      early-return, the job would go dark and look identical to a dead scheduler — exactly the
 *      bug found in draft-tick, where the wrap sat under a flag that defaults OFF.
 *
 *   2. MANUAL PATHS RECORD NOTHING. Dry runs and admin POSTs must not refresh the heartbeat: the
 *      probe matches on job_name alone, so a hand-issued row is indistinguishable from a
 *      scheduled fire and would let a curl returning 200 hide a dead scheduler.
 *
 *   3. THE jobName MATCHES THE PROBE EXACTLY. A typo here is silent — the probe reports CONFIG
 *      forever and the alarm never fires. Asserted against the real PROBES map, not a copy.
 *
 *   4. THE RESPONSE BODY IS UNCHANGED. These were refactors; callers must not notice.
 *
 * No DB and no network: the job libraries and Prisma are mocked. This proves route dispatch and
 * telemetry wiring only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { PROBES } from '../scripts/cron-freshness-check.mjs'

type SyncCtx = { jobName: string; trigger?: string; sport?: string | null; provider?: string | null }

const {
  withSyncJobRunMock,
  syncRuns,
  discoverDueWaiverLeaguesMock,
  processLeagueWaiversJobMock,
  writeAutomationAuditLogMock,
  refreshPlayoffScheduleMetadataForChallengeMock,
  prismaMock,
} = vi.hoisted(() => {
  const syncRuns: Array<{ ctx: SyncCtx; outcome: unknown }> = []
  return {
    syncRuns,
    /**
     * Stands in for the real helper and records every call. It DOES invoke the body and the
     * extractor: the real `safeExtract` swallows a throwing mapper, so a mapper reading a field
     * that does not exist would be invisible in production. Running it here surfaces that.
     */
    withSyncJobRunMock: vi.fn(async (ctx: SyncCtx, fn: () => Promise<unknown>, extract?: (r: unknown) => unknown) => {
      const result = await fn()
      syncRuns.push({ ctx, outcome: extract ? extract(result) : null })
      return result
    }),
    discoverDueWaiverLeaguesMock: vi.fn(),
    processLeagueWaiversJobMock: vi.fn(),
    writeAutomationAuditLogMock: vi.fn(async () => undefined),
    refreshPlayoffScheduleMetadataForChallengeMock: vi.fn(),
    prismaMock: {
      tournamentShell: { findMany: vi.fn() },
      tournamentLeague: { findMany: vi.fn() },
      tournamentAnnouncement: { updateMany: vi.fn() },
      legacyTournament: { findMany: vi.fn(), update: vi.fn() },
      playoffBracketChallenge: { findMany: vi.fn() },
    },
  }
})

vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ withSyncJobRun: withSyncJobRunMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/automation/audit', () => ({ writeAutomationAuditLog: writeAutomationAuditLogMock }))
vi.mock('@/lib/automation/errors', () => ({ toErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }))
vi.mock('@/lib/automation/jobs/waivers/discoverDueWaiverLeagues', () => ({
  discoverDueWaiverLeagues: discoverDueWaiverLeaguesMock,
}))
vi.mock('@/lib/automation/jobs/waivers/processLeagueWaiversJob', () => ({
  processLeagueWaiversJob: processLeagueWaiversJobMock,
}))
vi.mock('@/lib/playoffs/playoffSeriesSyncService', () => ({
  refreshPlayoffScheduleMetadataForChallenge: refreshPlayoffScheduleMetadataForChallengeMock,
}))
vi.mock('@/lib/tournament/advancementEngine', () => ({ calculateLeagueStandings: vi.fn() }))
vi.mock('@/lib/tournament/redraftScheduler', () => ({ handleRoundTransition: vi.fn() }))

import { GET as waiversGET } from '@/app/api/cron/waivers/route'
import { GET as tournamentGET, POST as tournamentPOST } from '@/app/api/tournament/automation/route'
import { GET as playoffGET } from '@/app/api/brackets/playoffs/cron/refresh-schedule/route'

const SECRET = 'test-cron-secret'
const ORIGINAL_ENV = { ...process.env }

/** Plain Request — enough for routes that read `request.url` and `request.headers`. */
function req(path: string, authed = true): never {
  const headers: Record<string, string> = {}
  if (authed) headers.authorization = `Bearer ${SECRET}`
  return new Request(`http://localhost${path}`, { headers }) as never
}

/**
 * `refresh-schedule` reads `request.nextUrl.searchParams`, which a bare Request does not have.
 * Built as a plain object rather than cloned from a Request: `Request.headers` is getter-only,
 * so Object.assign onto one throws.
 */
function nextReq(path: string, authed = true): never {
  const url = new URL(`http://localhost${path}`)
  const headers = new Headers()
  if (authed) headers.set('authorization', `Bearer ${SECRET}`)
  return { headers, url: url.toString(), nextUrl: url } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  syncRuns.length = 0
  process.env.CRON_SECRET = SECRET
  process.env.NODE_ENV = 'test'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

// ───────────────────────────── /api/cron/waivers ─────────────────────────────

describe('/api/cron/waivers heartbeat contract', () => {
  it('rejects an unauthenticated call without recording a heartbeat', async () => {
    const res = await waiversGET(req('/api/cron/waivers', false))
    expect(res.status).toBe(401)
    expect(withSyncJobRunMock).not.toHaveBeenCalled()
    expect(discoverDueWaiverLeaguesMock).not.toHaveBeenCalled()
  })

  it('records a heartbeat on a scheduled fire that finds NO work', async () => {
    // The whole premise. In August nothing is due, and this run is the only evidence the
    // scheduler is alive.
    discoverDueWaiverLeaguesMock.mockResolvedValue([])

    const res = await waiversGET(req('/api/cron/waivers'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(syncRuns).toHaveLength(1)
    expect(syncRuns[0].ctx).toMatchObject({ jobName: 'cron-waivers', trigger: 'cron' })
    expect(body).toEqual({ ok: true, dryRun: false, discovered: 0, processed: 0, failed: 0, results: [] })
  })

  it('records NO heartbeat for a dry run', async () => {
    discoverDueWaiverLeaguesMock.mockResolvedValue([])
    const res = await waiversGET(req('/api/cron/waivers?dryRun=true'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dryRun).toBe(true)
    expect(withSyncJobRunMock).not.toHaveBeenCalled()
  })

  it('still records a heartbeat when discovery throws, and redacts the response in production', async () => {
    // A failing job is still a job that RAN. Losing the heartbeat here would make a broken
    // discovery look exactly like a dead scheduler.
    process.env.NODE_ENV = 'production'
    discoverDueWaiverLeaguesMock.mockRejectedValue(new Error('pg: connection refused at 10.0.0.5'))

    const res = await waiversGET(req('/api/cron/waivers'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ ok: false, error: 'discovery_failed' })
    expect(body.error).not.toContain('10.0.0.5')
    expect(syncRuns).toHaveLength(1)
    expect(syncRuns[0].outcome).toMatchObject({ status: 'failed' })
  })

  it('reports a partial run when some leagues fail but the sweep completes', async () => {
    discoverDueWaiverLeaguesMock.mockResolvedValue([
      { leagueId: 'L1', pendingClaimCount: 1, scheduledFor: new Date(), waiverType: 'faab', metadata: {} },
      { leagueId: 'L2', pendingClaimCount: 2, scheduledFor: new Date(), waiverType: 'faab', metadata: {} },
    ])
    processLeagueWaiversJobMock
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('league blew up'))

    const res = await waiversGET(req('/api/cron/waivers'))
    const body = await res.json()

    // One league failing must not fail the sweep — the next fire retries it.
    expect(body.discovered).toBe(2)
    expect(body.failed).toBe(1)
    expect(syncRuns[0].outcome).toMatchObject({ status: 'partial', rowsRead: 2 })
  })
})

// ─────────────────────── /api/tournament/automation ──────────────────────────

describe('/api/tournament/automation heartbeat contract', () => {
  beforeEach(() => {
    prismaMock.tournamentShell.findMany.mockResolvedValue([])
    prismaMock.legacyTournament.findMany.mockResolvedValue([])
  })

  it('rejects an unauthenticated call without recording a heartbeat', async () => {
    const res = await tournamentGET(req('/api/tournament/automation', false))
    expect(res.status).toBe(401)
    expect(withSyncJobRunMock).not.toHaveBeenCalled()
  })

  it('records a heartbeat on a scheduled fire with no live tournament', async () => {
    const res = await tournamentGET(req('/api/tournament/automation'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(syncRuns).toHaveLength(1)
    expect(syncRuns[0].ctx.jobName).toBe('cron-tournament-automation')
    expect(body).toEqual({ processed: 0, legacyTournamentsProcessed: 0, errors: [] })
  })

  it('records NO heartbeat for the admin POST, but returns the same body', async () => {
    const res = await tournamentPOST(req('/api/tournament/automation'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(withSyncJobRunMock).not.toHaveBeenCalled()
    // `runAutomation` stopped returning a NextResponse in the refactor; both callers now wrap it.
    // If POST had been missed, this would be a JSON-serialised Response object, not the summary.
    expect(body).toEqual({ processed: 0, legacyTournamentsProcessed: 0, errors: [] })
  })
})

// ───────────── /api/brackets/playoffs/cron/refresh-schedule ──────────────────

describe('/api/brackets/playoffs/cron/refresh-schedule heartbeat contract', () => {
  beforeEach(() => {
    prismaMock.playoffBracketChallenge.findMany.mockResolvedValue([])
  })

  it('rejects an unauthenticated call without recording a heartbeat', async () => {
    const res = await playoffGET(nextReq('/api/brackets/playoffs/cron/refresh-schedule', false))
    expect(res.status).toBe(401)
    expect(withSyncJobRunMock).not.toHaveBeenCalled()
  })

  it('records a heartbeat outside the playoffs, when no challenge is active', async () => {
    const res = await playoffGET(nextReq('/api/brackets/playoffs/cron/refresh-schedule?sport=all&provider=espn'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(syncRuns).toHaveLength(1)
    expect(syncRuns[0].ctx).toMatchObject({ jobName: 'cron-playoff-schedule-refresh', trigger: 'cron' })
    expect(body).toMatchObject({ ok: true, job: 'playoff_schedule_refresh', challengeCount: 0, updatedSeries: 0 })
    expect(refreshPlayoffScheduleMetadataForChallengeMock).not.toHaveBeenCalled()
  })

  it('records NO heartbeat for a dry run', async () => {
    const res = await playoffGET(nextReq('/api/brackets/playoffs/cron/refresh-schedule?dryRun=true'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dryRun).toBe(true)
    expect(withSyncJobRunMock).not.toHaveBeenCalled()
  })

  it('does not leak a provider token into the 500 body when the sweep throws', async () => {
    // The most severe of the four redaction paths: this message goes to the CALLER, not just to a
    // log. `sanitizeErrorMessage` used to cover only `Bearer` and `key=`, so an RSC_token in a
    // provider URL was returned verbatim in the response body.
    prismaMock.playoffBracketChallenge.findMany.mockResolvedValue([{ id: 'C1' }])
    refreshPlayoffScheduleMetadataForChallengeMock.mockRejectedValue(
      new Error('upstream 502 for https://rest.datafeeds.rolling-insights.com/api/v1/x?RSC_token=leak-me-4242'),
    )

    const res = await playoffGET(nextReq('/api/brackets/playoffs/cron/refresh-schedule'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('leak-me-4242')
    expect(body.message).toContain('RSC_token=***')
    // Still diagnosable — redaction must not swallow which endpoint failed.
    expect(body.message).toContain('upstream 502')
  })

  it('aggregates per-challenge totals and reports warnings as a partial run', async () => {
    prismaMock.playoffBracketChallenge.findMany.mockResolvedValue([{ id: 'C1' }, { id: 'C2' }])
    refreshPlayoffScheduleMetadataForChallengeMock.mockResolvedValue({
      updatedSeries: 2,
      scheduleGamesSeen: 10,
      scheduleGamesMatched: 8,
      liveGamesMatched: 1,
      broadcastFieldsFound: 3,
      venueFieldsFound: 4,
      warnings: ['no venue'],
    })

    const res = await playoffGET(nextReq('/api/brackets/playoffs/cron/refresh-schedule'))
    const body = await res.json()

    expect(body.challengeCount).toBe(2)
    expect(body.updatedSeries).toBe(4)
    expect(body.scheduleGamesSeen).toBe(20)
    // Warnings are prefixed with their challenge id so a partial run says WHICH one degraded.
    expect(body.warnings).toEqual(['C1: no venue', 'C2: no venue'])
    expect(syncRuns[0].outcome).toMatchObject({ status: 'partial', rowsRead: 20, rowsWritten: 4, rowsSkipped: 4 })
  })
})

// ───────────────────── the wiring that fails silently ────────────────────────

describe('every route jobName matches the freshness probe exactly', () => {
  // A typo here is invisible: the probe reports CONFIG ("no rows for job_name ...") forever and
  // the alarm never fires. Asserted against the real PROBES map so the two cannot drift.
  it.each([
    ['/api/cron/waivers', 'cron-waivers'],
    ['/api/tournament/automation', 'cron-tournament-automation'],
    ['/api/brackets/playoffs/cron/refresh-schedule?sport=all&provider=espn', 'cron-playoff-schedule-refresh'],
  ])('%s is probed as %s', (cronPath, jobName) => {
    expect(PROBES[cronPath]?.heartbeat).toBe(jobName)
  })

  it('observed jobNames at runtime are the ones PROBES expects', async () => {
    // Not a restatement of the case above: that one reads the constant, this one reads what the
    // route actually PASSED to withSyncJobRun. They diverge if a route stops using its constant.
    discoverDueWaiverLeaguesMock.mockResolvedValue([])
    prismaMock.tournamentShell.findMany.mockResolvedValue([])
    prismaMock.legacyTournament.findMany.mockResolvedValue([])
    prismaMock.playoffBracketChallenge.findMany.mockResolvedValue([])

    await waiversGET(req('/api/cron/waivers'))
    await tournamentGET(req('/api/tournament/automation'))
    await playoffGET(nextReq('/api/brackets/playoffs/cron/refresh-schedule'))

    const observed = syncRuns.map((r) => r.ctx.jobName).sort()
    const expected = [
      PROBES['/api/cron/waivers'].heartbeat,
      PROBES['/api/tournament/automation'].heartbeat,
      PROBES['/api/brackets/playoffs/cron/refresh-schedule?sport=all&provider=espn'].heartbeat,
    ].sort()
    expect(observed).toEqual(expected)
  })
})
