/**
 * Heartbeat contract for `import-scores`, added 2026-08-23 alongside the probe move.
 *
 * WHY THIS EXISTS
 * The freshness probe for this job used to read `SportsGame.fetchedAt` -- the same table AND column
 * that `import-schedules` writes. With the fast tier dead, that produced a silent FALSE GREEN:
 * dispatching `import-schedules` alone flipped the `import-scores` probe from `STALE 23m` to
 * `ok 6m` and the fleet count from 20/32 to 21/32, as if a dead job had recovered.
 *
 * That is strictly worse than the wrong-table probes fixed earlier in #581: those were permanently
 * RED and therefore loud. This one reported healthy for a job that had not run at all, which is the
 * exact failure the monitor exists to catch.
 *
 * No column can separate the two jobs -- both write `rolling_insights` and `thesportsdb` rows, and
 * `runOneSport` calls `syncAPISportsGamesToDb`, so this job writes `api_sports` rows too. Scoping to
 * `source='espn'` fails for a subtler reason: `'espn'` is a member of `NflRedraftProviderId`, so the
 * redraft canonical sync can write that source as well. Only a heartbeat answers "did THIS job run".
 *
 * WHAT IS PINNED
 *   1. A GATED (NO-WORK) RUN STILL RECORDS A HEARTBEAT. This is the whole premise. The gate exists
 *      to conserve provider quota, so skipping IS the job working correctly -- and a wrap placed
 *      below that early return would go dark exactly when the job is healthiest. That mistake has
 *      already happened twice in this repo (draft-tick, morning-briefing).
 *   2. THE jobName MATCHES THE PROBE EXACTLY, asserted against the real PROBES map rather than a
 *      copy. A typo here is SILENT: the probe reports CONFIG forever and the alarm never fires.
 *   3. THE RESPONSE BODY IS UNCHANGED. This was a refactor; admin and manual callers must not
 *      notice.
 *
 * No DB and no network: Prisma and the provider libraries are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { PROBES } from '../scripts/cron-freshness-check.mjs'

type SyncCtx = { jobName: string; jobScope?: string | null; trigger?: string }

const { withSyncJobRunMock, syncRuns, prismaMock, fetchGamesForSportMock, syncAPISportsGamesToDbMock } =
  vi.hoisted(() => {
    const syncRuns: Array<{ ctx: SyncCtx; outcome: unknown }> = []
    return {
      syncRuns,
      /**
       * Invokes the body AND the extractor on purpose. The real `safeExtract` swallows a throwing
       * mapper, so an extractor reading a field that does not exist would be invisible in
       * production. Running it here surfaces that.
       */
      withSyncJobRunMock: vi.fn(
        async (ctx: SyncCtx, fn: () => Promise<unknown>, extract?: (r: unknown) => unknown) => {
          const result = await fn()
          syncRuns.push({ ctx, outcome: extract ? extract(result) : null })
          return result
        },
      ),
      prismaMock: { sportsGame: { findFirst: vi.fn(), upsert: vi.fn() } },
      fetchGamesForSportMock: vi.fn(),
      syncAPISportsGamesToDbMock: vi.fn(),
    }
  })

vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ withSyncJobRun: withSyncJobRunMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-sports', () => ({
  syncAPISportsGamesToDb: syncAPISportsGamesToDbMock,
  clearAPISportsDiagnostics: vi.fn(),
  getAPISportsDiagnostics: vi.fn(() => ({})),
}))
vi.mock('@/lib/scores/gameScoreProviders', () => ({ fetchGamesForSport: fetchGamesForSportMock }))

import { GET as importScoresGET } from '@/app/api/cron/import-scores/route'

const SECRET = 'test-cron-secret'
const ORIGINAL_ENV = { ...process.env }

function req(path: string, authed = true): never {
  const headers: Record<string, string> = {}
  if (authed) headers.authorization = `Bearer ${SECRET}`
  return new Request(`http://localhost${path}`, { headers }) as never
}

beforeEach(() => {
  syncRuns.length = 0
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  delete process.env.LEAGUE_CRON_SECRET
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('import-scores heartbeat contract', () => {
  /** A row fresher than GATE_SECONDS makes `isGated` true, so no provider is called. */
  function gateIsClosed() {
    prismaMock.sportsGame.findFirst.mockResolvedValue({ fetchedAt: new Date() })
  }

  it('records a heartbeat even when every sport is gated and no work happens', async () => {
    gateIsClosed()

    const res = await importScoresGET(req('/api/cron/import-scores'))

    expect(res.status).toBe(200)
    // The premise: quota-gated is the job WORKING, and it must still prove it woke up.
    expect(syncRuns).toHaveLength(1)
    expect(fetchGamesForSportMock).not.toHaveBeenCalled()
  })

  it('uses the exact jobName the freshness probe looks for', async () => {
    gateIsClosed()
    await importScoresGET(req('/api/cron/import-scores'))

    const probe = (PROBES as Record<string, { heartbeat?: string }>)['/api/cron/import-scores']
    // Asserted against the real map. A typo on either side is otherwise silent -- the probe
    // reports CONFIG forever and the alarm never fires.
    expect(probe?.heartbeat).toBe('cron-import-scores')
    expect(syncRuns[0]!.ctx.jobName).toBe(probe!.heartbeat)
  })

  it('does not probe SportsGame, the table import-schedules also writes', () => {
    const probe = (PROBES as Record<string, { table?: string; heartbeat?: string }>)[
      '/api/cron/import-scores'
    ]
    // The regression guard for the false green itself: any future move back onto this shared
    // table makes a dead import-scores look healthy whenever import-schedules runs.
    expect(probe?.table).toBeUndefined()
    expect(probe?.heartbeat).toBeTruthy()
  })

  it('reports gated sports through metadata, not warnings', async () => {
    gateIsClosed()
    await importScoresGET(req('/api/cron/import-scores'))

    const outcome = syncRuns[0]!.outcome as {
      warnings?: string[]
      errors?: string[]
      metadata?: { gatedSports?: string[] }
    }
    // `withSyncJobRun` infers status from errors/warnings. Gating is normal quota-respecting
    // behaviour, so a warning here would mark every healthy run 'partial' -- a job that looks
    // degraded whenever it behaves correctly is a muted alarm.
    expect(outcome.warnings ?? []).toHaveLength(0)
    expect(outcome.errors ?? []).toHaveLength(0)
    expect(outcome.metadata?.gatedSports?.length).toBeGreaterThan(0)
  })

  it('keeps the single-sport response shape for explicit ?sport= callers', async () => {
    gateIsClosed()

    const res = await importScoresGET(req('/api/cron/import-scores?sport=NFL'))
    const body = await res.json()

    // Admin and manual callers pass ?sport=; this was a refactor and they must not notice.
    expect(res.status).toBe(200)
    expect(body.sport).toBe('NFL')
    expect(body.gated).toBe(true)
    expect(body.sports).toBeUndefined()
  })

  it('rejects an unauthenticated call without recording a heartbeat', async () => {
    gateIsClosed()

    const res = await importScoresGET(req('/api/cron/import-scores', false))

    expect(res.status).toBe(401)
    // The probe matches on job_name alone, so a row written by an unauthenticated or hand-issued
    // call would be indistinguishable from a scheduled fire and could hide a dead scheduler.
    expect(syncRuns).toHaveLength(0)
  })
})
