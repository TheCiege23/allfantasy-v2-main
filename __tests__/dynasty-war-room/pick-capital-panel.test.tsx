import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

/**
 * The War Room panel's pick-capital card. An imported league with no known draft size can list only
 * the picks that changed hands; the card must not present that fragment as the team's capital, nor
 * an empty fragment as "you have no future picks".
 */

const state = vi.hoisted(() => ({ context: null as unknown }))
vi.mock('@/lib/dynasty-war-room/client', () => ({
  fetchDynastyWarRoomState: vi.fn(async () => ({ context: state.context, direction: null, needs: null })),
  analyzeDynastyWarRoomTrade: vi.fn(),
  askDynastyWarRoom: vi.fn(),
  fetchDynastyWarRoomBuySellHold: vi.fn(),
  fetchDynastyWarRoomLineup: vi.fn(),
  fetchDynastyWarRoomWaivers: vi.fn(),
  findDynastyWarRoomTrades: vi.fn(),
}))

import { DynastyWarRoomPanel } from '@/app/league/[leagueId]/tabs/dynasty/DynastyWarRoomPanel'

const acquired = {
  id: 'fdp:2027:1:2', season: 2027, round: 1, originalRosterId: 'r2', originalTeamName: 'Bravo',
  currentOwnerId: 'r1', traded: true, status: 'active', estValue: 8.5,
}

function contextWith(futurePicks: string, picks: unknown[]) {
  return {
    leagueId: 'L1', leagueType: 'dynasty', sport: 'NFL', season: 2026,
    scoring: { sport: 'NFL', scoringPreset: 'ppr', superflex: false, tePremium: false },
    roster: { totalStarterSlots: 0, benchSlots: 0, taxiSlots: 0, irSlots: 0, requiredByPosition: {} },
    userRosterId: 'r1', isCommissioner: false,
    teams: [{
      rosterId: 'r1', ownerId: 'u', ownerName: 'Alpha', teamName: 'Alpha', wins: 0, losses: 0, ties: 0,
      pointsFor: 0, playoffSeed: null, isUserTeam: true, players: [], picks,
    }],
    freeAgents: [], rookieDraftWindows: [],
    availability: {
      scoringRules: 'available', rosterRules: 'available', standings: 'missing', rosters: 'available',
      playerValues: 'missing', playerAges: 'missing', futurePicks, injuries: 'missing', news: 'missing',
      projections: 'missing', freeAgentPool: 'missing',
    },
    freshness: { generatedAt: '2026-09-17T00:00:00Z', valuesAsOf: null, injuriesAsOf: null },
    missingDataFlags: [],
    featureAvailability: {
      teamDirection: false, rosterNeeds: false, tradeAnalyze: true, tradeFind: false, buySellHold: false,
      waivers: false, lineup: false, pickValue: true,
    },
  }
}

async function card() {
  return screen.findByTestId('dynasty-war-room-pick-capital')
}

beforeEach(() => {
  state.context = null
})

describe('pick capital card', () => {
  it('[control] a complete list gets its count and tier total, and no caveat', async () => {
    state.context = contextWith('available', [acquired])
    render(<DynastyWarRoomPanel leagueId="L1" />)
    const el = await card()
    expect(el.textContent).toContain('1 picks · tier 8.5')
    expect(screen.queryByTestId('dynasty-war-room-pick-capital-partial')).toBeNull()
    expect(screen.getByTitle('Acquired from Bravo')).toBeTruthy()
  })

  it('🛑 a partial list is listed with a caveat, and no total', async () => {
    state.context = contextWith('partial', [acquired])
    render(<DynastyWarRoomPanel leagueId="L1" />)
    const el = await card()
    expect(screen.getByTestId('dynasty-war-room-pick-capital-list')).toBeTruthy()
    expect(el.textContent).not.toContain('picks · tier')
    expect(screen.getByTestId('dynasty-war-room-pick-capital-partial').textContent).toContain(
      'Only picks that changed hands are listed',
    )
    expect(screen.getByTestId('dynasty-war-room-direction-card').textContent).toContain('picks partial')
  })

  it('🛑 an empty partial list does not say "you have no future picks"', async () => {
    state.context = contextWith('partial', [])
    render(<DynastyWarRoomPanel leagueId="L1" />)
    await card()
    expect(screen.queryByTestId('dynasty-war-room-pick-capital-empty')).toBeNull()
    expect(screen.getByTestId('dynasty-war-room-pick-capital-partial').textContent).toContain(
      "your own picks aren't shown",
    )
  })

  it('[control] an empty complete list says there are none', async () => {
    state.context = contextWith('available_empty', [])
    render(<DynastyWarRoomPanel leagueId="L1" />)
    await card()
    expect(screen.getByTestId('dynasty-war-room-pick-capital-empty')).toBeTruthy()
    expect(screen.queryByTestId('dynasty-war-room-pick-capital-partial')).toBeNull()
  })
})
