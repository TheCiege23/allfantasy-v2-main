import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LeagueAnalyticsView } from '@/components/commissioner-os/analytics/LeagueAnalyticsView'
import { buildAnalyticsCsv } from '@/lib/commissioner-ui/analytics/exportCsv'
import { demoAnalyticsClient } from '@/lib/commissioner-ui/analytics/decision-os-client/demo'
import type {
  AnalyticsDataWindow,
  LeagueAnalyticsSnapshot,
} from '@/lib/commissioner-ui/analytics/decision-os-client/types'

/**
 * The regression suite for "0 of 7" — a KPI row that was arithmetically correct and read as a
 * statement about the league when it was a statement about our data being 18 days old.
 *
 * ⚠ EVERY ASSERTION HERE IS WRITTEN SO IT FAILS IF THE CAVEAT DISAPPEARS. The three states are
 * pinned separately on purpose: an assertion that only checks "some freshness text rendered"
 * would keep passing if `stale` silently degraded to the neutral `current` wording, which is
 * precisely the regression worth catching — the neutral line is the one that looks fine.
 */

const BASE: LeagueAnalyticsSnapshot = {
  kpis: [{ id: 'k1', label: 'Active Managers (last 90d)', value: '0 of 7' }],
  trends: [],
  competitiveBalance: [],
  scoringDistribution: [],
  transactionsByWeek: [],
  rosterUtilization: [],
  seasonComparison: [],
  healthByWeek: [],
  healthTarget: null,
  managerActivity: [],
  pointsForAgainst: [],
  dataWindow: null,
  generatedAt: '2026-09-07T20:00:00.000Z',
}

function windowAgedDays(days: number): AnalyticsDataWindow {
  return {
    lookbackDays: 90,
    inactiveAfterDays: 14,
    lastActivityAt: new Date(Date.now() - days * 86_400_000).toISOString(),
    daysSinceLastActivity: days,
    allTime: { tradeCount: 7, waiverCount: 31, eventCount: 137 },
  }
}

describe('commissioner-os analytics — data freshness', () => {
  it('names the staleness when the newest activity is older than the inactivity threshold', () => {
    render(<LeagueAnalyticsView snapshot={{ ...BASE, dataWindow: windowAgedDays(18) }} dataMode="live" />)

    // The specific claim: 18 days beats the 14-day threshold, so the KPIs describe our feed.
    expect(screen.getByText(/18 days ago/)).toBeInTheDocument()
    expect(screen.getByText(/inactive after 14 days/)).toBeInTheDocument()
    expect(screen.getByText(/137/)).toBeInTheDocument()
  })

  it('does NOT claim staleness when the data is inside the threshold', () => {
    render(<LeagueAnalyticsView snapshot={{ ...BASE, dataWindow: windowAgedDays(2) }} dataMode="live" />)

    /*
     * The positive control for the test above. If the stale branch ever fires unconditionally,
     * the assertion above would still pass and only this one would catch it.
     */
    expect(screen.queryByText(/inactive after 14 days/)).not.toBeInTheDocument()
    expect(screen.getByText(/Measured over the last/)).toBeInTheDocument()
  })

  it('distinguishes "no activity ever recorded" from a merely quiet league', () => {
    const never: AnalyticsDataWindow = {
      lookbackDays: 90,
      inactiveAfterDays: 14,
      lastActivityAt: null,
      daysSinceLastActivity: null,
      allTime: { tradeCount: 0, waiverCount: 0, eventCount: 0 },
    }
    render(<LeagueAnalyticsView snapshot={{ ...BASE, dataWindow: never }} dataMode="live" />)
    expect(screen.getByText(/No activity recorded for this league/)).toBeInTheDocument()
  })

  it('renders exactly as before when the window cannot be established', () => {
    // A null window must never invent reassurance — the pre-change page is the correct output.
    render(<LeagueAnalyticsView snapshot={BASE} dataMode="live" />)
    expect(screen.queryByText(/Measured over the last/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No activity recorded/)).not.toBeInTheDocument()
    expect(screen.getByText('0 of 7')).toBeInTheDocument()
  })

  it('carries the window into the CSV, because an exported file has no banner', () => {
    const csv = buildAnalyticsCsv({ ...BASE, dataWindow: windowAgedDays(18) })
    expect(csv).toContain('Newest league activity')
    expect(csv).toContain('Days since newest activity')
    expect(csv).toContain('All-time trades')

    // And omits the section entirely rather than emitting blank rows when there is no window.
    expect(buildAnalyticsCsv(BASE)).not.toContain('Data window')
  })

  it('demo mode ships a healthy window so the sales surface exercises the current state', async () => {
    const response = await demoAnalyticsClient.getSnapshot()
    const w = response.data!.dataWindow
    expect(w).not.toBeNull()
    expect(w!.daysSinceLastActivity).toBeLessThanOrEqual(w!.inactiveAfterDays)
  })
})
