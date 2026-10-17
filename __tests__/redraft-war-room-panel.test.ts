import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RedraftWarRoomPanel } from '@/app/league/[leagueId]/tabs/redraft/RedraftWarRoomPanel'

const client = vi.hoisted(() => ({
  fetchState: vi.fn(),
  fetchLineup: vi.fn(),
  fetchWaivers: vi.fn(),
  analyzeTrade: vi.fn(),
  findTrades: vi.fn(),
  ask: vi.fn(),
}))

vi.mock('@/lib/redraft-war-room/client', () => ({
  fetchRedraftWarRoomState: client.fetchState,
  fetchRedraftWarRoomLineup: client.fetchLineup,
  fetchRedraftWarRoomWaivers: client.fetchWaivers,
  analyzeRedraftWarRoomTrade: client.analyzeTrade,
  findRedraftWarRoomTrades: client.findTrades,
  askRedraftWarRoom: client.ask,
}))

function makeState() {
  return {
    context: {
      leagueId: 'lg-panel',
      sport: 'NFL',
      currentWeek: 6,
      totalWeeks: 17,
      missingDataFlags: ['Free-agent pool requires provider integration.'],
      freeAgents: [{ playerName: 'FA Wideout', position: 'WR', adp: 22.5 }],
      availability: {
        projections: 'available',
        tradeValues: 'available',
        injuries: 'missing',
        waiverPool: 'available',
      },
      upcomingMatchup: { week: 6, opponentRosterId: 'r2' },
      teams: [
        {
          rosterId: 'r1',
          isUserTeam: true,
          wins: 4,
          losses: 2,
          ties: 0,
          pointsFor: 742.4,
          playoffSeed: 3,
          players: [
            {
              playerId: 'p-out',
              playerName: 'Bench Runner',
              position: 'RB',
              isStarterSlot: false,
            },
          ],
        },
        { rosterId: 'r2', isUserTeam: false, teamName: 'Rivals', players: [] },
      ],
    },
    needs: {
      urgencyScore: 42,
      needs: [{ position: 'QB', severity: 'medium' }],
      strengths: ['WR'],
      tradeTargetPositions: ['QB'],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  client.fetchState.mockResolvedValue(makeState())
  client.fetchLineup.mockResolvedValue({
    lineup: {
      confidence: 'high',
      suggestedStarters: [{ slotName: 'QB', playerName: 'Runtime QB', valueUsed: 19.6 }],
      missingDataFlags: [],
    },
  })
  client.fetchWaivers.mockResolvedValue({
    waivers: {
      needsProviderIntegration: true,
      recommendedAdds: [],
      recommendedDrops: [{ playerId: 'p-out', playerName: 'Bench Runner', position: 'RB', reason: 'Depth' }],
      missingDataFlags: ['Free-agent pool requires provider integration.'],
    },
  })
  client.analyzeTrade.mockResolvedValue({
    tradeAnalysis: {
      verdict: 'needs_more_data',
      valueDelta: null,
      rosterFitDelta: 0,
      lineupImpact: [],
      benchImpact: [],
      playoffImpact: null,
      riskFlags: [],
      explanationFacts: ['No players resolved for this trade.'],
      missingDataFlags: ['No projection/stat signal for the involved players.'],
    },
  })
  client.findTrades.mockResolvedValue({
    tradeFinder: {
      rosterId: 'r1',
      targets: [{ rosterId: 'r2', teamName: 'Partner', fitScore: 40, theySupply: ['QB'], theyNeed: ['RB'], reasons: ['Fit.'] }],
      missingDataFlags: [],
      needsMoreData: false,
    },
  })
  client.ask.mockRejectedValue(new Error('Upgrade to access this feature.'))
})

describe('RedraftWarRoomPanel UI wiring', () => {
  it('renders the panel and calls every deterministic tool client', async () => {
    render(React.createElement(RedraftWarRoomPanel, { leagueId: 'lg-panel' }))

    expect(await screen.findByTestId('redraft-war-room-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('redraft-war-room-tool-lineup'))
    await screen.findByTestId('redraft-war-room-lineup-result')
    expect(client.fetchLineup).toHaveBeenCalledWith('lg-panel')

    fireEvent.click(screen.getByTestId('redraft-war-room-tool-waivers'))
    await screen.findByTestId('redraft-war-room-waivers-result')
    expect(client.fetchWaivers).toHaveBeenCalledWith('lg-panel')
    expect(screen.getAllByText(/provider integration/i).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByTestId('redraft-war-room-tool-trade-analyze'))
    const analyzed = await screen.findByTestId('redraft-war-room-trade-analyze-result')
    // 🛑 2026-09-29: no grade back is "Not graded" with the reason — never the engine's own verdict.
    expect(screen.getByTestId('redraft-war-room-trade-grade-withheld').textContent).toBe('Not graded: This trade could not be graded just now.')
    expect(analyzed.textContent).not.toMatch(/Verdict:|needs more data/i)
    expect(client.analyzeTrade).toHaveBeenCalledWith('lg-panel', {
      outgoingPlayerIds: ['p-out'],
      incomingPlayerIds: [],
    })

    fireEvent.click(screen.getByTestId('redraft-war-room-tool-trade-find'))
    await screen.findByTestId('redraft-war-room-trade-find-result')
    expect(client.findTrades).toHaveBeenCalledWith('lg-panel')
  })

  it('shows the locked ask state from the client error', async () => {
    render(React.createElement(RedraftWarRoomPanel, { leagueId: 'lg-panel' }))

    await screen.findByTestId('redraft-war-room-panel')
    fireEvent.change(screen.getByTestId('redraft-war-room-ask-input'), {
      target: { value: 'Who should I start?' },
    })
    fireEvent.click(screen.getByTestId('redraft-war-room-ask-submit'))

    await waitFor(() => expect(client.ask).toHaveBeenCalledWith('lg-panel', 'Who should I start?'))
    expect(await screen.findByTestId('redraft-war-room-ask-note')).toHaveTextContent(/upgrade/i)
  })
})
