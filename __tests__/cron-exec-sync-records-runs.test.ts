import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/api/cron/fantasy-os-exec-sync` must record a `SyncJobRun` on BOTH paths.
 *
 * 🛑 THE GATED PATH IS THE ONE THAT MATTERS. It answers 200 while doing nothing,
 * so before this the route was indistinguishable from a healthy one — and from a
 * dead one. A heartbeat that records only when it does work cannot tell "switched
 * off" from "never fired", which is the entire failure being closed here.
 */

vi.mock('server-only', () => ({}))

const requireCronAuthMock = vi.hoisted(() => vi.fn())
const resolveCadenceMock = vi.hoisted(() => vi.fn())
const runDueLeaguesMock = vi.hoisted(() => vi.fn())
const runExternalMatchupParityMock = vi.hoisted(() => vi.fn())
const runFantraxMatchupParityMock = vi.hoisted(() => vi.fn())
const refreshProfilesMock = vi.hoisted(() => vi.fn())
const materializeDraftsMock = vi.hoisted(() => vi.fn())
const recordSyncJobRunMock = vi.hoisted(() => vi.fn())
const withSyncJobRunMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: requireCronAuthMock }))
vi.mock('@/lib/import-os/season', () => ({ resolveCadence: resolveCadenceMock }))
vi.mock('@/lib/import-os/collector', () => ({
  runDueLeagues: runDueLeaguesMock,
  runExternalMatchupParity: runExternalMatchupParityMock,
  runFantraxMatchupParity: runFantraxMatchupParityMock,
}))
vi.mock('@/lib/psychological-profiles/ProfileRefreshService', () => ({
  refreshProfilesForExternalLeagues: refreshProfilesMock,
}))
vi.mock('@/lib/sleeper/sync/materializeSleeperDraftSessions', () => ({
  materializeSleeperDraftSessions: materializeDraftsMock,
}))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  recordSyncJobRun: recordSyncJobRunMock,
  withSyncJobRun: withSyncJobRunMock,
}))

const ENV = 'FANTASY_OS_EXEC_SYNC_LIVE'

function req() {
  return { url: 'http://localhost/api/cron/fantasy-os-exec-sync' } as never
}

const SUMMARY = {
  enumerated: 12,
  executed: 5,
  completed: 4,
  partial: 0,
  failed: 1,
  locked: 2,
  notDue: 5,
  results: [],
}

describe('exec-sync heartbeat run recording', () => {
  const original = process.env[ENV]

  beforeEach(() => {
    vi.clearAllMocks()
    requireCronAuthMock.mockReturnValue(true)
    resolveCadenceMock.mockReturnValue({ state: 'in_season', cadenceMinutes: 30 })
    runDueLeaguesMock.mockResolvedValue(SUMMARY)
    runExternalMatchupParityMock.mockResolvedValue({})
    runFantraxMatchupParityMock.mockResolvedValue({})
    refreshProfilesMock.mockResolvedValue({ leaguesProfiled: 0, managersProfiled: 0 })
    materializeDraftsMock.mockResolvedValue({})
    recordSyncJobRunMock.mockResolvedValue(undefined)
    // Faithful stand-in: run the body, hand the extractor its result, return it.
    withSyncJobRunMock.mockImplementation(async (_ctx, fn, extract) => {
      const result = await fn()
      if (extract) extract(result)
      return result
    })
  })

  afterEach(() => {
    if (original === undefined) delete process.env[ENV]
    else process.env[ENV] = original
    vi.resetModules()
  })

  it('records a run when the gate is CLOSED, and touches no provider', async () => {
    delete process.env[ENV]
    const { GET } = await import('@/app/api/cron/fantasy-os-exec-sync/route')
    const res = await GET(req())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ executed: false })

    // The whole point: a gated heartbeat leaves a row.
    expect(recordSyncJobRunMock).toHaveBeenCalledTimes(1)
    const [ctx, outcome] = recordSyncJobRunMock.mock.calls[0]!
    expect(ctx).toMatchObject({ jobName: 'cron-fantasy-os-exec-sync', trigger: 'cron' })
    /*
     * `enabled: false` is what separates this row from a run that found no work.
     * Both are zero-read, zero-written, status success — opposite situations.
     */
    expect(outcome.metadata).toMatchObject({ enabled: false })
    expect(outcome.status).toBe('success')
    expect(outcome.rowsWritten).toBe(0)

    // And it really did no work.
    expect(runDueLeaguesMock).not.toHaveBeenCalled()
  })

  it('records through withSyncJobRun when the gate is OPEN', async () => {
    process.env[ENV] = 'true'
    const { GET } = await import('@/app/api/cron/fantasy-os-exec-sync/route')
    const res = await GET(req())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ executed: true })

    expect(runDueLeaguesMock).toHaveBeenCalledTimes(1)
    expect(withSyncJobRunMock).toHaveBeenCalledTimes(1)
    expect(withSyncJobRunMock.mock.calls[0]![0]).toMatchObject({
      jobName: 'cron-fantasy-os-exec-sync',
      trigger: 'cron',
    })
    // The executing path uses the start/finish recorder, not the one-shot.
    expect(recordSyncJobRunMock).not.toHaveBeenCalled()
  })

  it('maps the collector summary into row counts and a partial status', async () => {
    process.env[ENV] = 'true'
    const { GET } = await import('@/app/api/cron/fantasy-os-exec-sync/route')
    await GET(req())

    const extract = withSyncJobRunMock.mock.calls[0]![2] as (r: unknown) => Record<string, unknown>
    const outcome = extract({ summary: SUMMARY })

    expect(outcome.rowsRead).toBe(12)
    expect(outcome.rowsWritten).toBe(4)
    expect(outcome.rowsSkipped).toBe(7) // notDue 5 + locked 2
    // One league failed: the heartbeat ran, but reporting plain success would
    // hide a provider outage affecting a subset of leagues behind a green row.
    expect(outcome.status).toBe('partial')
    expect(outcome.metadata).toMatchObject({ enabled: true, failed: 1 })
  })

  it('reports success when no league failed', async () => {
    process.env[ENV] = 'true'
    const { GET } = await import('@/app/api/cron/fantasy-os-exec-sync/route')
    await GET(req())

    const extract = withSyncJobRunMock.mock.calls[0]![2] as (r: unknown) => Record<string, unknown>
    const outcome = extract({ summary: { ...SUMMARY, failed: 0 } })
    expect(outcome.status).toBe('success')
  })

  it('records nothing when the request is not authorized', async () => {
    requireCronAuthMock.mockReturnValue(false)
    const { GET } = await import('@/app/api/cron/fantasy-os-exec-sync/route')
    const res = await GET(req())

    expect(res.status).toBe(401)
    // An unauthenticated probe must not be able to write heartbeat history.
    expect(recordSyncJobRunMock).not.toHaveBeenCalled()
    expect(withSyncJobRunMock).not.toHaveBeenCalled()
  })
})
