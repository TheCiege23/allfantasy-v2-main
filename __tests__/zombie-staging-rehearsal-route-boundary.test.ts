import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), tick: vi.fn(), prepare: vi.fn() }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: mocks.auth }))
vi.mock('@/lib/zombie/zombieAutomation', () => ({ runZombieAutomationTick: mocks.tick }))
vi.mock('@/lib/zombie/stagingRehearsal', () => ({ preparePhoneRehearsal: mocks.prepare }))
import { GET, POST } from '@/app/api/zombie/automation/route'
const req = (query = '', body: unknown = { sport: 'NBA' }) => new NextRequest('https://example.invalid/api/zombie/automation' + query, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('RAILWAY_PROJECT_ID', '2fa5548e-62f6-467d-9a63-6e6773c62f8a')
  vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'staging')
  vi.stubEnv('ZOMBIE_STAGING_REHEARSAL_ENABLED', '1')
  mocks.auth.mockReturnValue(true)
  mocks.tick.mockResolvedValue({ leaguesProcessed: 0, errors: [], skippedIdempotent: 0, skippedIncomplete: 0, announcementsPosted: 0 })
  mocks.prepare.mockResolvedValue({ leagueId: 'isolated-fixture', sport: 'NBA', created: true })
})
describe('staging fixture route boundary', () => {
  it('requires cron auth before touching fixtures or ordinary automation', async () => {
    mocks.auth.mockReturnValue(false)
    expect((await POST(req('?rehearsal=prepare-phone'))).status).toBe(401)
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.tick).not.toHaveBeenCalled()
  })
  it('rejects production, another project and disabled preparation', async () => {
    for (const [key, value] of [['RAILWAY_ENVIRONMENT_NAME', 'production'], ['RAILWAY_PROJECT_ID', 'another-project'], ['ZOMBIE_STAGING_REHEARSAL_ENABLED', '0']]) {
      const original = process.env[key]
      vi.stubEnv(key, value)
      expect((await POST(req('?rehearsal=prepare-phone'))).status).toBe(404)
      vi.stubEnv(key, original)
    }
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('allows only the four sports and never caller-chosen account or league IDs', async () => {
    for (const body of [{ sport: 'SOCCER' }, { sport: 'NBA', userId: 'other-owner' }, { sport: 'NBA', leagueId: 'original' }, null]) {
      expect((await POST(req('?rehearsal=prepare-phone', body))).status).toBe(400)
    }
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect((await POST(req('?rehearsal=prepare-phone'))).status).toBe(200)
    expect(mocks.prepare).toHaveBeenCalledWith('NBA')
    expect(mocks.tick).not.toHaveBeenCalled()
  })
  it('GET never prepares a fixture, and POST without the query keeps the ordinary cron path', async () => {
    expect((await GET(new NextRequest('https://example.invalid/api/zombie/automation?rehearsal=prepare-phone'))).status).toBe(200)
    expect((await POST(req())).status).toBe(200)
    expect(mocks.tick).toHaveBeenCalledTimes(2)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
})
