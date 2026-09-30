import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * The legacy league-home Players tab (`components/league/tabs/PlayersTab.tsx`) must not draw a
 * college prospect under "Trend". Its data used to rank `DevyPlayer.stockTrendDelta` — a LEVEL,
 * non-negative for every scored prospect — and the tab drew it as "+N.N" with a bar. The data side
 * no longer builds that list (`__tests__/league-home-college-no-trend.test.ts`); these pin the UI:
 * it says what the hub and per-league Devy tab say (`DEVY_NO_TREND_LABEL`), and it ignores a
 * college trend list even if a stale payload still carries one.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('playersTab=trend'),
}))
vi.mock('@/components/league-trade', () => ({ LeagueTradePanel: () => null }))
vi.mock('@/components/league/TradeCard', () => ({ ActiveTradeCard: () => null, TradeBlockCarousel: () => null }))
vi.mock('@/components/league/PlayerHeadshot', () => ({ default: () => null }))

import PlayersTab from '@/components/league/tabs/PlayersTab'
import { DEVY_NO_TREND_LABEL } from '@/lib/devy/devyTrend'
import type { LeaguePlayersData, ResolvedLeaguePlayer } from '@/components/league/types'

function player(id: string, name: string, extra: Partial<ResolvedLeaguePlayer> = {}): ResolvedLeaguePlayer {
  return {
    id,
    name,
    position: 'WR',
    team: null,
    headshotUrl: null,
    teamLogoUrl: null,
    injuryStatus: null,
    rosterPercent: null,
    startPercent: null,
    score: null,
    trendValue: null,
    adp: null,
    stats: [],
    ...extra,
  }
}

const college = player('c1', 'College Prospect', { source: 'college', trendValue: 14.2 })

function data(): LeaguePlayersData {
  return {
    search: [],
    trend: [player('p1', 'Pro Riser', { trendValue: 3.5 })],
    available: [],
    leaders: [],
    college: {
      // A stale payload shape: the list the server used to send. The tab must not draw it.
      ...({ trend: [college] } as object),
      available: [player('c2', 'Available Prospect', { source: 'college' })],
      leaders: [],
      availablePositions: ['WR'],
      availableSports: ['NCAAF'],
    } as LeaguePlayersData['college'],
  }
}

function mount() {
  return render(
    <PlayersTab leagueId="L1" players={data()} trades={{ tradeBlock: [], activeTrades: [], history: [] }} />,
  )
}

afterEach(cleanup)

describe('legacy Players tab — Trend never shows a college level as a trend', () => {
  it('[control] the Trend tab renders and still shows the pro trend list', () => {
    mount()
    expect(screen.getByText('Pro Riser')).toBeTruthy()
  })

  it('🛑 a college prospect is not drawn under Trend, and neither is its level', () => {
    const { container } = mount()
    expect(screen.queryByText('College Prospect')).toBeNull()
    expect(container.textContent).not.toContain('+14.2')
  })

  it('🛑 says no college trend is measured, in the words the Devy screens use', () => {
    mount()
    fireEvent.click(screen.getByText('COLLEGE PLAYERS'))
    expect(screen.queryByText('College Prospect')).toBeNull()
    expect(screen.getByTestId('college-trend-unmeasured').textContent).toContain(DEVY_NO_TREND_LABEL)
  })
})
