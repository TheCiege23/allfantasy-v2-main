import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import AIWaiverRecommendationsPanel from '@/components/waivers/AIWaiverRecommendationsPanel'
import CommissionerWaiverInsightsPanel from '@/components/waivers/CommissionerWaiverInsightsPanel'
import WaiverWirePage from '@/components/waiver-wire/WaiverWirePage'

vi.mock('@/hooks/useUserTimezone', () => ({
  useUserTimezone: () => ({
    timezone: null,
    formatInTimezone: () => '',
    formatTimeInTimezone: () => '',
    formatDateInTimezone: () => '',
  }),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Waiver AI UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows locked AF Pro state when API returns AF_PRO_REQUIRED', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/ai/waivers/recommend')) {
        return jsonResponse(
          {
            error: 'AF_PRO_REQUIRED',
            message: 'AI waiver recommendations are available with AF Pro.',
            upgradePath: '/pricing?plan=af-pro&feature=waiver-ai',
          },
          402,
        )
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AIWaiverRecommendationsPanel leagueId="league-1" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))

    await waitFor(() => {
      expect(screen.getByTestId('ai-waiver-recommendations-locked')).toBeInTheDocument()
    })
    // Brand voice: the panel names Chimmy, never a bare "AI" (was "AI waiver recommendations ...").
    expect(screen.getByText(/Chimmy's waiver recommendations are an AF Pro feature/i)).toBeInTheDocument()
  })

  it('renders AF Pro recommendation response fields and deeper analysis link', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/ai/waivers/recommend')) {
        return jsonResponse({
          ok: true,
          generatedAt: '2026-05-11T12:00:00.000Z',
          recommendations: [
            {
              addPlayerId: 'p-add',
              addPlayerName: 'Tank Dell',
              dropPlayerId: 'p-drop',
              dropPlayerName: 'Bench WR',
              priority: 1,
              suggestedFaabBid: 12,
              confidence: 'high',
              risk: 'low',
              reasoning: 'High target share with favorable matchup.',
              deeperAnalysisPath: '/chimmy/chat?topic=waiver-analysis&leagueId=league-1',
              tags: ['WR', 'waiver_target', 'faab'],
            },
          ],
        })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AIWaiverRecommendationsPanel leagueId="league-1" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))

    await waitFor(() => {
      expect(screen.getByTestId('ai-waiver-recommendations-results')).toBeInTheDocument()
    })

    expect(screen.getByText(/Tank Dell/i)).toBeInTheDocument()
    expect(screen.getByText(/Bench WR/i)).toBeInTheDocument()
    expect(screen.getByText(/FAAB: 12/i)).toBeInTheDocument()
    expect(screen.getByText(/Confidence: high/i)).toBeInTheDocument()
    expect(screen.getByText(/Risk: low/i)).toBeInTheDocument()
    expect(screen.getByText(/High target share with favorable matchup/i)).toBeInTheDocument()

    const link = screen.getByTestId('ai-waiver-recommendation-chimmy-1')
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toContain('/chimmy/chat?topic=waiver-analysis&leagueId=league-1')

    // Verify panel only calls recommendation endpoint and does not post to league chat.
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(requestedUrls.some((url) => url.includes('/api/ai/waivers/recommend'))).toBe(true)
    expect(requestedUrls.some((url) => url.includes('/api/chat') || url.includes('/league-chat'))).toBe(false)
  })

  it('renders commissioner locked state for AF_COMMISSIONER_REQUIRED', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/commissioner/leagues/league-1/waivers?type=settings')) {
        return jsonResponse({ ok: true }, 200)
      }
      if (url.includes('/api/ai/waivers/commissioner-insights')) {
        return jsonResponse(
          {
            error: 'AF_COMMISSIONER_REQUIRED',
            message: 'League-wide AI waiver tools require AF Commissioner.',
            upgradePath: '/pricing?plan=af-commissioner&feature=commissioner-waiver-ai',
          },
          402,
        )
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CommissionerWaiverInsightsPanel leagueId="league-1" />)

    await waitFor(() => {
      expect(screen.getByTestId('commissioner-waiver-insights-panel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('commissioner-waiver-insights-load'))

    await waitFor(() => {
      expect(screen.getByTestId('commissioner-waiver-insights-locked')).toBeInTheDocument()
    })
    expect(screen.getByText(/League-wide AI waiver tools require AF Commissioner/i)).toBeInTheDocument()
  })

  it('renders commissioner insights settings and fairness warnings', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/commissioner/leagues/league-1/waivers?type=settings')) {
        return jsonResponse({ ok: true }, 200)
      }
      if (url.includes('/api/ai/waivers/commissioner-insights')) {
        return jsonResponse({
          settingsHealth: [{ code: 'FAAB_BUDGET_MISSING', message: 'FAAB budget is missing.', severity: 'error' }],
          suspiciousPatterns: [{ code: 'HIGH_CLAIM_VOLUME', message: 'Unusual claim volume.' }],
          fairnessWarnings: [{ code: 'HIGH_ZERO_BID_RATE', message: 'Too many $0 winning bids.' }],
          recommendedSettingsChanges: [{ code: 'CONSIDER_FAAB', suggestion: 'Consider moving to FAAB.' }],
        })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CommissionerWaiverInsightsPanel leagueId="league-1" />)

    await waitFor(() => {
      expect(screen.getByTestId('commissioner-waiver-insights-panel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('commissioner-waiver-insights-load'))

    await waitFor(() => {
      expect(screen.getByTestId('commissioner-waiver-insights-results')).toBeInTheDocument()
    })

    expect(screen.getByText(/FAAB budget is missing/i)).toBeInTheDocument()
    expect(screen.getByText(/Too many \$0 winning bids/i)).toBeInTheDocument()
    expect(screen.getByText(/Consider moving to FAAB/i)).toBeInTheDocument()
  })

  it('regular waiver page still renders without AI access', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/waiver-wire/leagues/league-1/settings')) {
        return jsonResponse({ waiverType: 'rolling', sport: 'NFL' })
      }
      if (url.includes('/api/waiver-wire/leagues/league-1/claims?type=history')) {
        return jsonResponse({ claims: [], transactions: [] })
      }
      if (url.includes('/api/waiver-wire/leagues/league-1/claims')) {
        return jsonResponse({ claims: [] })
      }
      if (url.includes('/api/waiver-wire/leagues/league-1/players')) {
        return jsonResponse({ players: [] })
      }
      if (url.includes('/api/league/roster?leagueId=league-1')) {
        return jsonResponse({ roster: [], faabRemaining: null, waiverPriority: null })
      }
      if (url.includes('/api/waiver-wire/leagues/league-1/state')) {
        return jsonResponse({ state: { nextRunAt: null, processingLocked: false } })
      }
      if (url.includes('/api/commissioner/leagues/league-1/waivers?type=settings')) {
        return jsonResponse({ error: 'forbidden' }, 403)
      }
      if (url.includes('/api/monetization/context')) {
        return jsonResponse({})
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WaiverWirePage leagueId="league-1" />)

    await waitFor(() => {
      expect(screen.getByText('Waiver Wire')).toBeInTheDocument()
    })

    expect(screen.getByTestId('waiver-automation-status')).toBeInTheDocument()
  })
})
