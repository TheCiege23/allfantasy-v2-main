import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Mission Control's activity trend sits behind Mission Control's own switch (commissioner_os_live_ready_mission-control)
 * like every other method on that client (owner's call, 2026-11-23), so one switch turns the whole page off.
 */

const h = vi.hoisted(() => ({ ready: vi.fn(), trend: vi.fn() }))
vi.mock('@/lib/commissioner-ui/liveReadiness', () => ({ isLiveReady: h.ready }))
vi.mock('@/lib/commissioner-ui/resolveActiveLeagueId', () => ({ resolveActiveLeagueId: vi.fn(async () => 'L1') }))
vi.mock('@/lib/commissioner-mission-control/activityTrendReads', () => ({ readLeagueActivityTrend: h.trend }))
vi.mock('@/lib/commissioner-mission-control/managerHighlightReads', () => ({ readManagerHighlights: vi.fn() }))
vi.mock('@/lib/commissioner-ui/analytics/dataWindow', () => ({ readAnalyticsDataWindow: vi.fn() }))
vi.mock('@/lib/commissioner-ui/adapter/transport', () => ({ callDecisionOS: vi.fn() }))

import { liveDecisionOSClient } from '@/lib/commissioner-ui/decision-os-client/live'

beforeEach(() => {
  vi.clearAllMocks()
  h.trend.mockResolvedValue([{ week: 1, events: 3 }])
})

describe('Mission Control activity trend switch', () => {
  it('switch on: reads the league trend', async () => {
    h.ready.mockResolvedValue(true)
    const r = await liveDecisionOSClient.getActivityTrend()
    expect(h.ready).toHaveBeenCalledWith('mission-control')
    expect(r).toMatchObject({ error: null, data: [{ week: 1, events: 3 }] })
    expect(h.trend).toHaveBeenCalledWith('L1')
  })

  it('switch off: no read, and an error instead of data', async () => {
    h.ready.mockResolvedValue(false)
    const r = await liveDecisionOSClient.getActivityTrend()
    expect(r.data).toBeNull()
    expect(r.error).not.toBeNull()
    expect(h.trend).not.toHaveBeenCalled()
  })
})
