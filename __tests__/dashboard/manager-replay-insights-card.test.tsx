/**
 * Phase 20/21 — Manager Replay Insights dashboard panel test (display-only).
 * Renders the client panel against a mocked internal-route fetch and proves
 * every honest state (loading, disabled, error, empty, ready), the richer
 * Phase 21 presentation (4-category summary grid, meta line, honest trends
 * empty-state, prominent historical-context label + non-recommendation
 * disclaimer, responsive grid), and that no internal replay key/ID surfaces.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ManagerReplayInsightsCard } from '@/components/dashboard/ManagerReplayInsightsCard'
import type { ManagerReplayInsightSetV1, ManagerReplayInsightV1 } from '@/lib/replay-framework/insights/managerReplayInsight'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED', 'true')
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
})

function makeInsight(overrides: Partial<ManagerReplayInsightV1> = {}): ManagerReplayInsightV1 {
  return {
    insightId: 'replay_insight_starter_impact_trades',
    category: 'starter_impact_trades',
    headline: 'Your starter-impact trades paid off',
    detail: 'Trades that upgraded your active starting lineup changed your lineup efficiency by about +1.4 pts and left roughly 8% of acquired players unused.',
    displayValue: '+1.4 pts efficiency',
    sentiment: 'positive',
    confidence: 'high',
    sampleSize: 44,
    caveat: null,
    ...overrides,
  }
}

function makeSet(insights: ManagerReplayInsightV1[]): ManagerReplayInsightSetV1 {
  return {
    scope: 'league',
    insights,
    tradesAnalyzed: 141,
    tradesWithLineupData: 114,
    validationSource: 'decision_replay_correlation',
    version: 'replay-insight-v1',
    derivedAt: '2026-07-07T00:00:00.000Z',
  }
}

/** The full four-category set, mirroring the Phase 16 validated finding. */
function fullSet(): ManagerReplayInsightSetV1 {
  return makeSet([
    makeInsight(),
    makeInsight({ insightId: 'replay_insight_bench_depth_trades', category: 'bench_depth_trades', headline: "Bench-depth trades didn't move your lineup", displayValue: '-1.1 pts efficiency', sentiment: 'caution', confidence: 'moderate', sampleSize: 70 }),
    makeInsight({ insightId: 'replay_insight_wasted_acquisitions', category: 'wasted_acquisitions', headline: '9% of acquired players never started', displayValue: '9% unused', sentiment: 'neutral', sampleSize: 141 }),
    makeInsight({ insightId: 'replay_insight_lineup_efficiency_impact', category: 'lineup_efficiency_impact', headline: "Trading didn't measurably change your overall lineup efficiency", displayValue: '-0.1 pts', sentiment: 'neutral', sampleSize: 110 }),
  ])
}

function resolveWith(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValue({ ok, status, json: async () => body })
}

describe('ManagerReplayInsightsCard — states', () => {
  it('is fully inert (renders nothing, never fetches) when the client flag is off', () => {
    vi.stubEnv('NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED', 'false')
    const { container } = render(<ManagerReplayInsightsCard leagueId="L1" />)
    expect(container.textContent).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a loading state before the fetch resolves', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    render(<ManagerReplayInsightsCard leagueId="L1" />)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('renders nothing when the feature is server-disabled', async () => {
    resolveWith({ enabled: false })
    const { container } = render(<ManagerReplayInsightsCard leagueId="L1" />)
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
    expect(container.textContent).toBe('')
  })

  it('shows an honest empty state when there are no insights', async () => {
    resolveWith({ enabled: true, data: makeSet([]) })
    render(<ManagerReplayInsightsCard leagueId="L1" />)
    expect(await screen.findByText(/Not enough completed-trade history/i)).toBeTruthy()
  })

  it('shows an error state when the request fails', async () => {
    resolveWith({}, false, 500)
    render(<ManagerReplayInsightsCard leagueId="L1" />)
    expect(await screen.findByText(/couldn.t be loaded/i)).toBeTruthy()
  })
})

describe('ManagerReplayInsightsCard — populated panel', () => {
  it('renders all four category tiles with their headlines and display values', async () => {
    resolveWith({ enabled: true, data: fullSet() })
    render(<ManagerReplayInsightsCard leagueId="L1" />)
    expect(await screen.findByText('Your starter-impact trades paid off')).toBeTruthy()
    expect(screen.getByText("Bench-depth trades didn't move your lineup")).toBeTruthy()
    expect(screen.getByText('9% of acquired players never started')).toBeTruthy()
    expect(screen.getByText(/Trading didn't measurably change/)).toBeTruthy()
    // display values (summary metrics) from the contract, verbatim
    expect(screen.getByText('+1.4 pts efficiency')).toBeTruthy()
    expect(screen.getByText('-1.1 pts efficiency')).toBeTruthy()
    expect(screen.getByText('9% unused')).toBeTruthy()
    // category labels
    expect(screen.getByText('Starter-impact trades')).toBeTruthy()
    expect(screen.getByText('Bench-depth trades')).toBeTruthy()
  })

  it('renders the trades-analyzed meta line from the contract counts', async () => {
    resolveWith({ enabled: true, data: fullSet() })
    render(<ManagerReplayInsightsCard leagueId="L1" />)
    expect(await screen.findByText(/Based on 141 completed trades \(114 with lineup data\)\./i)).toBeTruthy()
  })

  it('prominently labels the panel and shows the non-recommendation disclaimer', async () => {
    resolveWith({ enabled: true, data: fullSet() })
    render(<ManagerReplayInsightsCard leagueId="L1" />)
    expect(await screen.findByText('Historical Replay Insights')).toBeTruthy()
    expect(screen.getByText(/not recommendations for future moves/i)).toBeTruthy()
  })

  it('shows an honest trends empty-state (never fabricates a trend from a single snapshot)', async () => {
    resolveWith({ enabled: true, data: fullSet() })
    render(<ManagerReplayInsightsCard leagueId="L1" />)
    expect(await screen.findByText(/Trend history isn.t available yet/i)).toBeTruthy()
  })

  it('uses a responsive grid (single column on mobile, two columns from the sm breakpoint)', async () => {
    resolveWith({ enabled: true, data: fullSet() })
    render(<ManagerReplayInsightsCard leagueId="L1" />)
    const grid = await screen.findByTestId('replay-insight-grid')
    expect(grid.className).toContain('grid')
    expect(grid.className).toContain('sm:grid-cols-2')
  })
})

describe('ManagerReplayInsightsCard — no internal leakage', () => {
  it('does not surface the internal insightId slug or the raw validationSource token in the DOM', async () => {
    resolveWith({ enabled: true, data: fullSet() })
    const { container } = render(<ManagerReplayInsightsCard leagueId="L1" />)
    await screen.findByText('Your starter-impact trades paid off')
    expect(container.textContent).not.toContain('replay_insight_')
    expect(container.textContent).not.toContain('decision_replay_correlation')
  })

  it('renders a low-sample caveat when present', async () => {
    resolveWith({ enabled: true, data: makeSet([
      makeInsight({ confidence: 'insufficient', sampleSize: 2, caveat: 'Based on only 2 of your trades — treat as directional, not conclusive. Across 141 real validated trades, starter-impact deals gained about +1.4 pts of lineup efficiency.' }),
    ]) })
    render(<ManagerReplayInsightsCard leagueId="L1" />)
    expect(await screen.findByText(/Based on only 2 of your trades/i)).toBeTruthy()
  })
})
