import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ run: vi.fn(), confirm: vi.fn(), record: vi.fn(), blog: vi.fn() }))
const BLOG_OFF = { ran: false, reason: 'off', created: [], wouldCreate: [], skipped: [] }
// Daily blog drafts ride this route too; the runner has its own suite (daily-blog-drafts).
vi.mock('@/lib/automated-blog/daily/runDailyBlogDrafts', () => ({
  parseDailyDraftMode: (raw: string) => (raw === 'off' || raw === 'dry' ? raw : 'run'),
  runDailyBlogDrafts: h.blog,
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
// Find a League saved-search alerts ride this route too (their own suite: find-league-step3); nothing is due here.
vi.mock('@/lib/public-discovery/runSavedSearchAlerts', () => ({
  runSavedSearchAlerts: vi.fn(async () => ({ due: 0, checked: 0, alerted: 0, errors: [], budgetExhausted: false })),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/resend-client', () => ({ sendTemplatedEmail: vi.fn() }))
vi.mock('@/lib/dashboard-intel/commandCenterService', () => ({ getCommandCenter: vi.fn() }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  recordSyncJobRun: h.record,
}))
vi.mock('@/lib/onboarding-retention/runActivationReminder', () => ({ runActivationReminder: h.run }))
vi.mock('@/lib/onboarding-retention/runConfirmEmailReminder', () => ({ runConfirmEmailReminder: h.confirm }))

import { GET } from '@/app/api/cron/morning-briefing/route'

/**
 * The reminder rides the daily briefing fire, and follows its rollout rule: nothing is emailed until
 * the deployment opts in. A dry run can always be asked for, and never breaks the briefing.
 */

const RUN = { dryRun: false, candidates: 3, sent: 2, due: { first: 2, second: 0 }, skipped: {}, failed: 0, notReached: 0, errors: [] }
const CONFIRM = { dryRun: false, candidates: 5, sent: 4, due: { first: 3, second: 1 }, skipped: {}, failed: 0, notReached: 0, errors: [] }
const call = async (qs = '') =>
  (await GET(new NextRequest(`https://worker.test/api/cron/morning-briefing${qs}`, { headers: { authorization: 'Bearer s3cret' } }))).json()

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 's3cret')
  vi.stubEnv('MORNING_BRIEFING_ENABLED', '0')
  vi.stubEnv('ACTIVATION_REMINDER_ENABLED', '')
  h.run.mockReset().mockResolvedValue(RUN)
  h.confirm.mockReset().mockResolvedValue(CONFIRM)
  h.record.mockReset()
  h.blog.mockReset().mockResolvedValue(BLOG_OFF)
})
afterEach(() => vi.unstubAllEnvs())

describe('morning-briefing — the activation reminder', () => {
  it('🛑 sends nothing until the deployment turns it on', async () => {
    const body = await call()
    expect(h.run).not.toHaveBeenCalled()
    expect(h.confirm).not.toHaveBeenCalled()
    // Disabled, the briefing's body is exactly what it was before the reminders existed.
    expect(body).toEqual({ mode: 'cron', enabled: false, note: 'Set MORNING_BRIEFING_ENABLED=1 to enable the daily sweep.' })
  })

  it('runs and records its own heartbeat once enabled — even with the briefing itself off', async () => {
    vi.stubEnv('ACTIVATION_REMINDER_ENABLED', '1')
    const body = await call()
    expect(h.run).toHaveBeenCalledWith({ dryRun: false })
    expect(h.confirm).toHaveBeenCalledWith({ dryRun: false })
    expect(body.activationReminder).toEqual(RUN)
    expect(body.confirmEmailReminder).toEqual(CONFIRM)
    expect(h.record).toHaveBeenCalledTimes(2)
    expect(h.record.mock.calls[0]![0]).toMatchObject({ jobName: 'cron-activation-reminder' })
    expect(h.record.mock.calls[0]![1]).toMatchObject({ rowsRead: 3, rowsWritten: 2, status: 'success' })
    // The confirm-your-email reminder writes its OWN heartbeat, with its own numbers.
    expect(h.record.mock.calls[1]![0]).toMatchObject({ jobName: 'cron-confirm-email-reminder' })
    expect(h.record.mock.calls[1]![1]).toMatchObject({ rowsRead: 5, rowsWritten: 4, status: 'success' })
  })

  it('a dry run works whatever the flag, and records nothing', async () => {
    const body = await call('?activationReminder=dry')
    expect(h.run).toHaveBeenCalledWith({ dryRun: true })
    expect(h.confirm).toHaveBeenCalledWith({ dryRun: true })
    expect(body.confirmEmailReminder).toEqual(CONFIRM)
    expect(h.record).not.toHaveBeenCalled()
  })

  it('can be skipped for a run, and never fails the briefing', async () => {
    vi.stubEnv('ACTIVATION_REMINDER_ENABLED', '1')
    const off = await call('?activationReminder=off')
    expect(off.activationReminder).toEqual({ ran: false, reason: 'off' })
    expect(off.confirmEmailReminder).toEqual({ ran: false, reason: 'off' })
    h.run.mockRejectedValue(new Error('db down'))
    const body = await call()
    expect(body.activationReminder).toEqual({ ran: false, reason: 'error', error: 'db down' })
    // One reminder failing does not stop the other.
    expect(body.confirmEmailReminder).toEqual(CONFIRM)
    h.confirm.mockRejectedValue(new Error('smtp down'))
    expect((await call()).confirmEmailReminder).toEqual({ ran: false, reason: 'error', error: 'smtp down' })
    expect(body.mode).toBe('cron')
  })

  it('without the cron secret, it is not a cron call at all', async () => {
    vi.stubEnv('ACTIVATION_REMINDER_ENABLED', '1')
    const res = await GET(new NextRequest('https://worker.test/api/cron/morning-briefing'))
    expect(res.status).toBe(401)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.blog).not.toHaveBeenCalled()
  })
})

describe('morning-briefing — the daily blog drafts', () => {
  const REPORT = {
    ran: true,
    date: '2026-11-14',
    created: [{ sport: 'NBA', slug: 'nba-fantasy-standouts-2026-11-14', articleId: 'a1' }],
    wouldCreate: [],
    skipped: [{ sport: 'NHL', reason: 'fact_check_failed', detail: 'numbers: 41' }],
  }

  it('passes the ?blogDrafts mode through, and a run that did something is reported with its own heartbeat', async () => {
    h.blog.mockResolvedValue(REPORT)
    const body = await call()
    expect(h.blog).toHaveBeenCalledWith({ mode: 'run' })
    expect(body.blogDrafts).toEqual(REPORT)
    expect(h.record).toHaveBeenCalledTimes(1)
    expect(h.record.mock.calls[0]![0]).toMatchObject({ jobName: 'cron-blog-daily-drafts' })
    // A discarded draft is the check working, not a failure of the job.
    expect(h.record.mock.calls[0]![1]).toMatchObject({ rowsWritten: 1, rowsSkipped: 1, status: 'success', errors: [] })

    await call('?blogDrafts=dry')
    expect(h.blog).toHaveBeenLastCalledWith({ mode: 'dry' })
  })

  it('a model or save failure marks the heartbeat partial', async () => {
    h.blog.mockResolvedValue({ ...REPORT, created: [], skipped: [{ sport: 'NBA', reason: 'generation_failed', detail: 'status 500' }] })
    await call()
    expect(h.record.mock.calls[0]![1]).toMatchObject({ status: 'partial', errors: ['NBA: generation_failed (status 500)'] })
  })

  it('switched off it leaves the body as it was, and a crash never fails the briefing', async () => {
    const off = await call('?blogDrafts=off')
    expect(off).toEqual({ mode: 'cron', enabled: false, note: 'Set MORNING_BRIEFING_ENABLED=1 to enable the daily sweep.' })
    expect(h.record).not.toHaveBeenCalled()

    h.blog.mockRejectedValue(new Error('db down'))
    const body = await call()
    expect(body.mode).toBe('cron')
    expect(body.blogDrafts).toEqual({ ran: false, reason: 'error', error: 'db down' })
  })
})
