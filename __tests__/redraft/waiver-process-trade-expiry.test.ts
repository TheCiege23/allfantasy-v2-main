import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/api/redraft/waiver-process` is the scheduled caller for redraft trade-proposal expiry (audit #25).
 *
 * 🛑 A sweep nobody calls is the same bug in a new place. These pin that the hourly cron GET runs it under
 * its OWN `sync_job_runs` identity, that a sweep failure can never cost the league its waiver processing,
 * and that an unauthorized request runs nothing.
 */

const h = vi.hoisted(() => ({
  requireCronAuth: vi.fn(() => true),
  withSyncJobRun: vi.fn(async (_config: { jobName: string }, fn: () => Promise<unknown>) => fn()),
  processWaiverWindow: vi.fn(async () => []),
  seasonsFindMany: vi.fn(async () => [{ id: 'season-1', leagueId: 'league-1' }]),
  exileRollover: vi.fn(async () => ({ processed: 1, released: 2, scored: 0, pending: 1, errors: [] })),
  expireDue: vi.fn(async () => ({ due: 2, expired: 2, skipped: 0, failures: [] })),
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: h.requireCronAuth }))
vi.mock('@/lib/adminAuth', () => ({ requireAdminOrBearer: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ withSyncJobRun: h.withSyncJobRun }))
vi.mock('@/lib/redraft/waiverEngine', () => ({ processWaiverWindow: h.processWaiverWindow }))
vi.mock('@/lib/redraft/seasonStatus', () => ({ engineSeasonScope: () => ({}), SCORING_SEASON_STATUSES: ['active', 'playoffs'] }))
vi.mock('@/lib/prisma', () => ({ prisma: { redraftSeason: { findMany: h.seasonsFindMany } } }))
vi.mock('@/lib/survivor/survivorExileRollover', () => ({ runExileRosterRollover: h.exileRollover }))
vi.mock('@/lib/redraft/tradeProposalExpiry', () => ({ expireDueRedraftTradeProposals: h.expireDue }))

const get = async () => {
  const { GET } = await import('@/app/api/redraft/waiver-process/route')
  return GET(new Request('http://localhost/api/redraft/waiver-process', { headers: { authorization: 'Bearer test' } }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireCronAuth.mockReturnValue(true)
})

describe('/api/redraft/waiver-process schedules redraft trade expiry', () => {
  it('🛑 the cron GET runs the expiry sweep under its own job identity', async () => {
    const res = await get()

    expect(res.status).toBe(200)
    expect(h.expireDue).toHaveBeenCalledTimes(1)
    const jobNames = h.withSyncJobRun.mock.calls.map(([config]) => config.jobName)
    expect(jobNames).toContain('cron-redraft-trade-proposal-expiry')
    expect(jobNames).toContain('cron-redraft-waiver-process')
    expect(jobNames).toContain('cron-survivor-exile-rosters')
    expect(h.exileRollover).toHaveBeenCalledOnce()
    await expect(res.json()).resolves.toMatchObject({ tradeExpiry: { due: 2, expired: 2 } })
  })

  it('🛑 a failing expiry sweep does not cost the league its waiver processing', async () => {
    h.expireDue.mockRejectedValueOnce(new Error('expiry sweep exploded'))

    const res = await get()

    expect(res.status).toBe(200)
    expect(h.processWaiverWindow).toHaveBeenCalledWith('league-1', 'season-1')
    await expect(res.json()).resolves.toMatchObject({
      results: [{ seasonId: 'season-1' }],
      tradeExpiry: { error: 'expiry sweep exploded' },
    })
  })

  it('an Exile rollover failure does not cost the league its waiver processing', async () => {
    h.exileRollover.mockRejectedValueOnce(new Error('Exile snapshot pending'))
    const res = await get()
    expect(h.processWaiverWindow).toHaveBeenCalledWith('league-1', 'season-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ exileRollover: { error: 'Exile snapshot pending' } })
  })

  it('runs nothing for an unauthorized request', async () => {
    h.requireCronAuth.mockReturnValue(false)

    const res = await get()

    expect(res.status).toBe(401)
    expect(h.exileRollover).not.toHaveBeenCalled()
    expect(h.expireDue).not.toHaveBeenCalled()
    expect(h.processWaiverWindow).not.toHaveBeenCalled()
  })
})
