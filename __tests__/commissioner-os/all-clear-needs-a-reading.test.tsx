import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * "Your league is in good shape" is a claim about the league, and an empty list cannot make it alone.
 * Seen 2026-10-01 in a signed-in check: Mission Control said it directly under a League Health card
 * reading "Unavailable". A failed read falls back to `[]`, and an unavailable health reading falls
 * back to a zero score — both used to render as an all-clear.
 */

const resolveCommissionerOsDepth = vi.hoisted(() => vi.fn())
const getDecisionOSAdapter = vi.hoisted(() => vi.fn())
vi.mock('@/lib/commissioner-ui/commissionerOsDepth', () => ({ resolveCommissionerOsDepth }))
vi.mock('@/lib/commissioner-ui/adapter', () => ({ getDecisionOSAdapter }))
vi.mock('@/lib/commissioner-ui/resolveActiveLeagueId', () => ({
  viewerOwnsActiveLeague: vi.fn(async () => true),
  resolveActiveLeagueId: vi.fn(async () => 'league-1'),
}))

import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'
import { allClearCopy } from '@/lib/commissioner-ui/allClear'
import MissionControlPage from '@/app/commissioner-os/page'
import LeagueHealthPage from '@/app/commissioner-os/league-health/page'

const ok = <T,>(data: T) => ({ data, error: null, source: 'stub' as const, timestamp: '2026-10-01T00:00:00.000Z' })
const failed = { data: null, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'down' }, source: 'stub' as const, timestamp: '2026-10-01T00:00:00.000Z' }
const GOOD = 'good shape'

function adapter(over: { health?: unknown; queue?: unknown; detail?: unknown; risks?: unknown; healthRecs?: unknown } = {}) {
  return {
    mode: 'stub',
    missionControl: {
      getActivityTrend: async () => ok({ points: [], lookbackDays: null }),
      getLeagueHealthSummary: async () => over.health ?? ok({ score: 92, tier: 'positive', trendLabel: '', trendDirection: 'flat', driver: 'Steady' }),
      getManagerHighlights: async () => ok([]),
      getMissionControlKpis: async () => ok({ openRecommendations: 0, activeRisks: 0, engagementScore: 92, nextDeadlineLabel: 'None' }),
    },
    recommendations: { getQueue: async () => over.queue ?? ok([]) },
    activity: { getEvents: async () => ok([]) },
    automations: { getSummary: async () => ok({ totalCount: 0, activeCount: 0, needsAttentionCount: 0, headline: 'None' }) },
    analytics: { getSummary: async () => ok({ headline: 'None', kpiCount: 0 }) },
    reports: { getSummary: async () => ok({ headline: 'None', scheduledCount: 0, readyCount: 0 }) },
    notifications: { getSummary: async () => ok({ headline: 'None', unreadCount: 0, criticalCount: 0 }) },
    leagueHealth: {
      getHealthDetail: async () => over.detail ?? ok({ score: 92, tier: 'positive', retentionRisk: 'positive', commissionerWorkload: 'positive', participation: { activeManagers: 10, totalManagers: 10 }, completeness: 1 }),
      getRisks: async () => over.risks ?? ok([]),
      getEvidence: async () => ok([]),
      getRecommendations: async () => over.healthRecs ?? ok([]),
    },
  }
}

beforeEach(() => {
  resolveCommissionerOsDepth.mockResolvedValue(
    decideCoreDepth('commissioner_depth', { live: true, startsAt: new Date('2026-10-15T04:00:00.000Z'), hasPlan: true }),
  )
})

describe('allClearCopy', () => {
  const base = { emptyTitle: 'No active risks.', healthyDescription: 'The league is in good shape.', listName: 'risks' }

  it('keeps the reassurance only when the list was read and health is healthy enough', () => {
    for (const tier of ['positive', 'advisory', 'standard'] as const) {
      expect(allClearCopy({ ...base, listRead: true, healthTier: tier }).description).toBe('The league is in good shape.')
    }
  })

  it('says a list it could not read could not be read', () => {
    expect(allClearCopy({ ...base, listRead: false, healthTier: 'positive' })).toEqual({
      title: 'Couldn’t load risks.',
      description: 'That isn’t the same as having none. Try again shortly.',
    })
  })

  it('makes no claim about the league without a health reading', () => {
    const r = allClearCopy({ ...base, listRead: true, healthTier: null })
    expect(r.title).toBe('No active risks.')
    expect(r.description).not.toMatch(/good shape/)
  })

  it('says a poor score disagrees with the empty list', () => {
    expect(allClearCopy({ ...base, listRead: true, healthTier: 'critical' }).description).toMatch(/critical/)
    expect(allClearCopy({ ...base, listRead: true, healthTier: 'elevated' }).description).toMatch(/elevated/)
  })
})

describe('Mission Control page', () => {
  it('[control] reassures when the queue was read and health is good', async () => {
    getDecisionOSAdapter.mockResolvedValue(adapter())
    render(await MissionControlPage())
    expect(screen.getByText('Your league is in good shape.')).toBeInTheDocument()
  })

  it('🛑 does not call the league healthy when league health could not be read', async () => {
    getDecisionOSAdapter.mockResolvedValue(adapter({ health: failed }))
    render(await MissionControlPage())
    expect(screen.queryByText(new RegExp(GOOD))).not.toBeInTheDocument()
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument()
    expect(screen.getByText(/isn’t a verdict on the league/)).toBeInTheDocument()
    // The fallback's zero is not presented as a score.
    expect(screen.getByText(/Not available yet/)).toBeInTheDocument()
    expect(screen.queryByText(/^0 — /)).not.toBeInTheDocument()
  })

  it('🛑 says the queue could not be loaded, rather than that nothing needs attention', async () => {
    getDecisionOSAdapter.mockResolvedValue(adapter({ queue: failed }))
    render(await MissionControlPage())
    expect(screen.getByText('Couldn’t load recommendations.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing needs your attention right now.')).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp(GOOD))).not.toBeInTheDocument()
  })

  it('does not reassure under a critical score', async () => {
    getDecisionOSAdapter.mockResolvedValue(adapter({ health: ok({ score: 12, tier: 'critical', trendLabel: '', trendDirection: 'down', driver: 'Inactive managers' }) }))
    render(await MissionControlPage())
    expect(screen.queryByText(new RegExp(GOOD))).not.toBeInTheDocument()
    expect(screen.getByText(/League health is critical/)).toBeInTheDocument()
  })
})

describe('League Health page', () => {
  it('[control] reassures twice when everything was read and health is good', async () => {
    getDecisionOSAdapter.mockResolvedValue(adapter())
    render(await LeagueHealthPage())
    expect(screen.getAllByText('The league is in good shape.')).toHaveLength(2)
  })

  it('🛑 makes no all-clear claim when the health detail could not be read', async () => {
    getDecisionOSAdapter.mockResolvedValue(adapter({ detail: failed }))
    render(await LeagueHealthPage())
    expect(screen.queryByText(new RegExp(GOOD))).not.toBeInTheDocument()
    expect(screen.getAllByText(/isn’t a verdict on the league/)).toHaveLength(2)
  })

  it('🛑 a failed risks read is not "No active risks."', async () => {
    getDecisionOSAdapter.mockResolvedValue(adapter({ risks: failed, healthRecs: failed }))
    render(await LeagueHealthPage())
    expect(screen.getByText('Couldn’t load risks.')).toBeInTheDocument()
    expect(screen.getByText('Couldn’t load recommendations.')).toBeInTheDocument()
    expect(screen.queryByText('No active risks.')).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp(GOOD))).not.toBeInTheDocument()
  })
})
