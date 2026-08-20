import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'
import { GET } from '@/app/api/cron/draft-expired-timers/route'

const logStructured = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logging/structured', () => ({
  logStructured: (...a: unknown[]) => logStructured(...a),
}))

describe('GET /api/cron/draft-expired-timers', () => {
  const originalSecret = process.env.CRON_SECRET
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    logStructured.mockClear()
  })

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET
    } else {
      process.env.CRON_SECRET = originalSecret
    }
    process.env.NODE_ENV = originalNodeEnv
  })

  it('returns 503 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(
      createMockNextRequest('http://localhost:3000/api/cron/draft-expired-timers', {
        headers: { authorization: 'Bearer any' },
      }),
    )
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('CRON_SECRET')
  })

  it('returns 401 when secret is set but Authorization is missing or wrong', async () => {
    process.env.CRON_SECRET = 'cron-test-secret'

    const noAuth = await GET(createMockNextRequest('http://localhost:3000/api/cron/draft-expired-timers'))
    expect(noAuth.status).toBe(401)

    const bad = await GET(
      createMockNextRequest('http://localhost:3000/api/cron/draft-expired-timers', {
        headers: { authorization: 'Bearer wrong' },
      }),
    )
    expect(bad.status).toBe(401)
  })

  it('does not accept query secret in production NODE_ENV', async () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    process.env.NODE_ENV = 'production'
    const res = await GET(
      createMockNextRequest(
        `http://localhost:3000/api/cron/draft-expired-timers?secret=${encodeURIComponent('cron-test-secret')}`,
      ),
    )
    expect(res.status).toBe(401)
  })

  it('invokes processExpiredDraftTimersBatch when Bearer matches CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    process.env.NODE_ENV = 'test'

    const cronMod = await import('@/lib/live-draft-engine/cron/expiredDraftTimerCron')
    const spy = vi.spyOn(cronMod, 'processExpiredDraftTimersBatch').mockResolvedValue({
      scanned: 2,
      processed: 2,
      changed: 1,
      skippedLockBusy: 0,
      skippedTimerFresh: 0,
      skippedNotInProgress: 0,
      skippedCronPolicy: 0,
      errors: [],
    })

    const res = await GET(
      createMockNextRequest('http://localhost:3000/api/cron/draft-expired-timers?limit=5', {
        headers: { authorization: 'Bearer cron-test-secret' },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.scanned).toBe(2)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }))
    spy.mockRestore()
  })

  it('dryRun returns discovery payload without calling batch', async () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    process.env.NODE_ENV = 'test'

    const cronMod = await import('@/lib/live-draft-engine/cron/expiredDraftTimerCron')
    const batchSpy = vi.spyOn(cronMod, 'processExpiredDraftTimersBatch')
    const discoverSpy = vi.spyOn(cronMod, 'discoverExpiredDraftTimerLeagues').mockResolvedValue(['L-a', 'L-b'])

    const res = await GET(
      createMockNextRequest('http://localhost:3000/api/cron/draft-expired-timers?dryRun=true', {
        headers: { authorization: 'Bearer cron-test-secret' },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.discovered).toBe(2)
    expect(batchSpy).not.toHaveBeenCalled()
    discoverSpy.mockRestore()
    batchSpy.mockRestore()
  })
})
