import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ run: vi.fn(), record: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/resend-client', () => ({ sendTemplatedEmail: vi.fn() }))
vi.mock('@/lib/dashboard-intel/commandCenterService', () => ({ getCommandCenter: vi.fn() }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  recordSyncJobRun: h.record,
}))
vi.mock('@/lib/onboarding-retention/runActivationReminder', () => ({ runActivationReminder: h.run }))

import { GET } from '@/app/api/cron/morning-briefing/route'

/**
 * The reminder rides the daily briefing fire, and follows its rollout rule: nothing is emailed until
 * the deployment opts in. A dry run can always be asked for, and never breaks the briefing.
 */

const RUN = { dryRun: false, candidates: 3, sent: 2, due: { first: 2, second: 0 }, skipped: {}, failed: 0, notReached: 0, errors: [] }
const call = async (qs = '') =>
  (await GET(new NextRequest(`https://worker.test/api/cron/morning-briefing${qs}`, { headers: { authorization: 'Bearer s3cret' } }))).json()

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 's3cret')
  vi.stubEnv('MORNING_BRIEFING_ENABLED', '0')
  vi.stubEnv('ACTIVATION_REMINDER_ENABLED', '')
  h.run.mockReset().mockResolvedValue(RUN)
  h.record.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('morning-briefing — the activation reminder', () => {
  it('🛑 sends nothing until the deployment turns it on', async () => {
    const body = await call()
    expect(h.run).not.toHaveBeenCalled()
    // Disabled, the briefing's body is exactly what it was before the reminder existed.
    expect(body).toEqual({ mode: 'cron', enabled: false, note: 'Set MORNING_BRIEFING_ENABLED=1 to enable the daily sweep.' })
  })

  it('runs and records its own heartbeat once enabled — even with the briefing itself off', async () => {
    vi.stubEnv('ACTIVATION_REMINDER_ENABLED', '1')
    const body = await call()
    expect(h.run).toHaveBeenCalledWith({ dryRun: false })
    expect(body.activationReminder).toEqual(RUN)
    expect(h.record).toHaveBeenCalledTimes(1)
    expect(h.record.mock.calls[0]![0]).toMatchObject({ jobName: 'cron-activation-reminder' })
    expect(h.record.mock.calls[0]![1]).toMatchObject({ rowsRead: 3, rowsWritten: 2, status: 'success' })
  })

  it('a dry run works whatever the flag, and records nothing', async () => {
    await call('?activationReminder=dry')
    expect(h.run).toHaveBeenCalledWith({ dryRun: true })
    expect(h.record).not.toHaveBeenCalled()
  })

  it('can be skipped for a run, and never fails the briefing', async () => {
    vi.stubEnv('ACTIVATION_REMINDER_ENABLED', '1')
    expect((await call('?activationReminder=off')).activationReminder).toEqual({ ran: false, reason: 'off' })
    h.run.mockRejectedValue(new Error('db down'))
    const body = await call()
    expect(body.activationReminder).toEqual({ ran: false, reason: 'error', error: 'db down' })
    expect(body.mode).toBe('cron')
  })

  it('without the cron secret, it is not a cron call at all', async () => {
    vi.stubEnv('ACTIVATION_REMINDER_ENABLED', '1')
    const res = await GET(new NextRequest('https://worker.test/api/cron/morning-briefing'))
    expect(res.status).toBe(401)
    expect(h.run).not.toHaveBeenCalled()
  })
})
