import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Automation Center's run history shows each run's error message and league id. It must show only the
 * commissioner's own league's runs (and platform-wide ones) — read across the whole ledger it handed every
 * commissioner other leagues' failures (2026-11-23 audit).
 */

const h = vi.hoisted(() => ({ where: [] as unknown[], leagueId: 'L-mine' as string | null }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    automationRun: {
      findMany: vi.fn(async (q: { where: unknown }) => {
        h.where.push(q.where)
        return [
          { id: 'r1', jobType: 'weekly_digest', leagueId: 'L-mine', startedAt: new Date('2026-11-20T10:00:00Z'), durationMs: 900, status: 'failed', errorMessage: 'my league failed', metadata: null },
        ]
      }),
    },
  },
}))
vi.mock('@/lib/commissioner-ui/liveReadiness', () => ({ isLiveReady: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner-ui/resolveActiveLeagueId', () => ({ resolveActiveLeagueId: vi.fn(async () => h.leagueId) }))

import { readAutomationRuns } from '@/lib/commissioner-automations/automationLedgerReads'
import { liveAutomationClient } from '@/lib/commissioner-ui/automations/decision-os-client/live'

beforeEach(() => {
  h.where.length = 0
  h.leagueId = 'L-mine'
})

describe('automation run history is league-scoped', () => {
  it('reads only this league and platform-wide runs', async () => {
    await readAutomationRuns('weekly_digest', 'L-mine')
    expect(h.where[0]).toEqual({ jobType: 'weekly_digest', OR: [{ leagueId: 'L-mine' }, { leagueId: null }] })
  })

  it("the Automation Center asks for the active league's runs", async () => {
    const res = await liveAutomationClient.getExecutionHistory('weekly_digest')
    expect(h.where[0]).toMatchObject({ OR: [{ leagueId: 'L-mine' }, { leagueId: null }] })
    expect(res.data?.[0]).toMatchObject({ summary: 'my league failed' })
  })

  it('with no league the viewer commissions, it reads nothing and shows nothing', async () => {
    h.leagueId = null
    const res = await liveAutomationClient.getExecutionHistory('weekly_digest')
    expect(h.where).toHaveLength(0)
    expect(res).toMatchObject({ data: [], error: null })
  })
})
