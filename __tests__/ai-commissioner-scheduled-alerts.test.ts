// @vitest-environment node
/**
 * "Commissioner AI alerts" runs on the daily commissioner cron for leagues that switched it on and
 * whose owner has AF Commissioner (lib/ai-commissioner/scheduledAlertsBatch.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ leagues: vi.fn(), user: vi.fn(), plan: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: h.leagues }, appUser: { findUnique: h.user } } }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: h.plan }))
vi.mock('@/lib/ai-commissioner/AICommissionerService', () => ({ runAICommissionerCycle: vi.fn() }))

import { runScheduledAiCommissionerAlerts } from '@/lib/ai-commissioner/scheduledAlertsBatch'

beforeEach(() => {
  vi.clearAllMocks()
  h.user.mockResolvedValue({ email: 'o@x.test', username: 'o' })
})

describe('runScheduledAiCommissionerAlerts', () => {
  it('asks only for switched-on leagues in an active phase', async () => {
    h.leagues.mockResolvedValue([])
    await runScheduledAiCommissionerAlerts({ run: vi.fn() })
    expect(h.leagues.mock.calls[0][0].where).toEqual({
      leagueAiCommissionerAlerts: true,
      lifecycleState: { in: ['pre_draft', 'drafting', 'post_draft', 'in_season', 'playoffs'] },
    })
  })

  it('runs the cycle where the owner has AF Commissioner, skips the rest, and checks each owner once', async () => {
    h.leagues.mockResolvedValue([
      { id: 'A', sport: 'NBA', userId: 'paid' },
      { id: 'B', sport: 'NFL', userId: 'free' },
      { id: 'C', sport: 'NBA', userId: 'paid' },
      { id: 'D', sport: 'NBA', userId: null },
    ])
    h.plan.mockImplementation(async (u: { id: string }) => u.id === 'paid')
    const run = vi.fn(async () => ({ createdAlerts: [{}, {}] }))
    const r = await runScheduledAiCommissionerAlerts({ run: run as never })
    expect(run.mock.calls.map((c) => (c as unknown as [{ leagueId: string }])[0].leagueId)).toEqual(['A', 'C'])
    expect(run).toHaveBeenCalledWith({ leagueId: 'A', sport: 'NBA', source: 'scheduled' })
    expect(h.plan).toHaveBeenCalledTimes(2)
    expect(h.plan).toHaveBeenCalledWith({ id: 'paid', email: 'o@x.test', username: 'o' })
    expect(r).toEqual({ discovered: 4, ran: 2, skippedNoPlan: 2, failed: 0, created: 4 })
  })

  it('one league failing does not stop the others', async () => {
    h.leagues.mockResolvedValue([{ id: 'A', sport: 'NBA', userId: 'u' }, { id: 'B', sport: 'NBA', userId: 'u' }])
    h.plan.mockResolvedValue(true)
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ createdAlerts: [] })
    const r = await runScheduledAiCommissionerAlerts({ run })
    expect(r).toMatchObject({ ran: 1, failed: 1 })
  })
})
