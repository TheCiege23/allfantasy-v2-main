// @vitest-environment node
/**
 * Close finishes and upsets ride the weekly-awards cron: the same fire, right AFTER the recaps, inside
 * the same run budget (lib/cron/runBudget) — no new cron route. The recaps stop with a reserve left so
 * the moments pass always gets a turn, and the pass reports what it did in the run's telemetry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  order: [] as string[],
  remaining: 240_000,
  sweep: vi.fn(),
  extract: null as null | ((r: unknown) => Record<string, unknown>),
  leagues: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: async () => h.leagues } } }))
vi.mock('next-auth', () => ({ getServerSession: async () => null }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/resend-client', () => ({ sendTemplatedEmail: vi.fn() }))
vi.mock('@/lib/notifications/designedEmail', () => ({ renderDigestEmail: vi.fn() }))
vi.mock('@/lib/trade-intel/tradeGradeEmail', () => ({ escapeHtml: (s: string) => s }))
vi.mock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'http://localhost' }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>, extract: (r: unknown) => Record<string, unknown>) => {
    h.extract = extract
    return fn()
  },
}))
vi.mock('@/lib/cron/runBudget', () => ({
  createRunBudget: () => ({
    exhausted: () => h.remaining <= 0,
    elapsedMs: () => 240_000 - h.remaining,
    remainingMs: () => h.remaining,
  }),
}))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({
  getLeagueH2H: async () => {
    h.order.push('recap:read')
    return null // "no completed week synced yet" — the recap path itself is tested elsewhere
  },
}))
vi.mock('@/lib/league-chat/weeklyRecapMoment', () => ({
  buildWeeklyRecap: vi.fn(),
  postWeeklyRecapAsChimmy: vi.fn(),
  weeklyRecapAlreadyPosted: vi.fn(),
}))
vi.mock('@/lib/league-chat/weekMatchupMoments', () => ({ runWeekMatchupMomentsSweep: h.sweep }))

import { GET } from '@/app/api/cron/weekly-awards/route'

const cronRequest = () =>
  new Request('http://localhost/api/cron/weekly-awards', { headers: { authorization: 'Bearer test-secret' } }) as never

const MOMENTS = { leagues: 3, posted: 2, noMoments: 1, notFinal: 0, duplicate: 0, disabled: 0, dailyCap: 0, skipped: 0, failed: 0, skippedForTime: 0 }

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret'
  h.order = []
  h.remaining = 240_000
  h.extract = null
  h.leagues = [{ id: 'L1', name: 'Iron Horse', platformLeagueId: 'SL-1', userId: 'commish', settings: null }]
  h.sweep.mockReset().mockImplementation(async (deps: { budget: { remainingMs: () => number } }) => {
    h.order.push(`moments:${deps.budget.remainingMs()}`)
    return MOMENTS
  })
})

describe('the weekly-awards cron posts close finishes and upsets after the recaps', () => {
  it('runs the moments pass once, after the recaps, on the same budget', async () => {
    const res = await GET(cronRequest())
    const body = await res.json()
    expect(h.order).toEqual(['recap:read', 'moments:240000'])
    expect(h.sweep).toHaveBeenCalledTimes(1)
    expect(body.moments).toEqual(MOMENTS)
    // The run's telemetry counts the moment posts and carries the pass's counts.
    const outcome = h.extract!(body)
    expect(outcome).toMatchObject({ rowsWritten: 0 + 2, metadata: { moments: MOMENTS } })
  })

  it('the recaps stop with a reserve left, so the moments pass still gets its turn', async () => {
    h.remaining = 50_000
    const body = await (await GET(cronRequest())).json()
    expect(body.skippedForTime).toBe(1)
    expect(h.order).toEqual(['moments:50000'])
    expect(h.sweep).toHaveBeenCalledTimes(1)
  })

  it('a moments pass that ran out of time says so in the run’s warnings', async () => {
    h.sweep.mockResolvedValue({ ...MOMENTS, skippedForTime: 4 })
    const body = await (await GET(cronRequest())).json()
    expect(h.extract!(body).warnings).toEqual([expect.stringMatching(/close finishes\/upsets not checked for 4 league/)])
  })
})
