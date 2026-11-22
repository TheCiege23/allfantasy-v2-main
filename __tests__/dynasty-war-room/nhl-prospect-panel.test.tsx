import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

/**
 * The War Room panel's waiver result lists NHL dynasty prospects after the recommended adds, with the
 * draft board's "Prospect" badge and "Unsigned" label (#3051, #3063). Any other league renders
 * nothing extra, and the "N FAs" count stays the ranked pool.
 */

const state = vi.hoisted(() => ({ context: null as unknown, waivers: null as unknown }))
vi.mock('@/lib/dynasty-war-room/client', () => ({
  fetchDynastyWarRoomState: vi.fn(async () => ({ context: state.context, direction: null, needs: null })),
  analyzeDynastyWarRoomTrade: vi.fn(),
  askDynastyWarRoom: vi.fn(),
  fetchDynastyWarRoomBuySellHold: vi.fn(),
  fetchDynastyWarRoomLineup: vi.fn(),
  fetchDynastyWarRoomWaivers: vi.fn(async () => ({ waivers: state.waivers })),
  findDynastyWarRoomTrades: vi.fn(),
}))

import { DynastyWarRoomPanel } from '@/app/league/[leagueId]/tabs/dynasty/DynastyWarRoomPanel'

const realFa = {
  playerId: 'real center|c', playerName: 'Real Center', position: 'C', team: null, slotType: 'free_agent',
  isStarterSlot: false, age: 24, dynastyValue: 50, adp: 12, injuryStatus: null, weekProjection: null, hasNoValueSignal: false,
}
const prospectFa = {
  ...realFa, playerId: 'fantrax:04qyf', playerName: 'Cameron Hillis', age: null, dynastyValue: null, adp: null,
  hasNoValueSignal: true, prospectSource: 'fantrax',
}

function context(sport: string, freeAgents: unknown[]) {
  return {
    leagueId: 'L1', leagueType: 'dynasty', sport, season: 2026,
    scoring: { sport, scoringPreset: 'points', superflex: false, tePremium: false },
    roster: { totalStarterSlots: 0, benchSlots: 0, taxiSlots: 0, irSlots: 0, requiredByPosition: {} },
    userRosterId: 'r1', isCommissioner: false,
    teams: [{
      rosterId: 'r1', ownerId: 'u', ownerName: 'Alpha', teamName: 'Alpha', wins: 0, losses: 0, ties: 0,
      pointsFor: 0, playoffSeed: null, isUserTeam: true, players: [], picks: [],
    }],
    freeAgents, rookieDraftWindows: [],
    availability: {
      scoringRules: 'available', rosterRules: 'available', standings: 'missing', rosters: 'available',
      playerValues: 'available', playerAges: 'available', futurePicks: 'missing', injuries: 'missing', news: 'missing',
      projections: 'missing', freeAgentPool: 'available',
    },
    freshness: { generatedAt: '2026-10-31T00:00:00Z', valuesAsOf: null, injuriesAsOf: null },
    missingDataFlags: [],
    featureAvailability: {
      teamDirection: true, rosterNeeds: true, tradeAnalyze: true, tradeFind: true, buySellHold: true,
      waivers: true, lineup: true, pickValue: false,
    },
  }
}

function waivers(extra: Record<string, unknown> = {}) {
  return {
    rosterId: 'r1',
    recommendedAdds: [{ playerId: 'real center|c', playerName: 'Real Center', position: 'C', value: 50, age: 24, trajectory: 'ascending', adp: 12, reason: 'Fills C need (ADP 12.0).' }],
    recommendedDrops: [],
    targetPositions: ['C'],
    riskFlags: [],
    missingDataFlags: [],
    needsProviderIntegration: false,
    ...extra,
  }
}

async function openWaivers() {
  render(<DynastyWarRoomPanel leagueId="L1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Waivers' }))
  return screen.findByTestId('dynasty-war-room-waivers-result')
}

beforeEach(() => {
  state.context = null
  state.waivers = null
})

describe('Dynasty War Room panel: NHL prospects in the waiver result', () => {
  it('lists prospects after the adds with the Prospect badge and Unsigned label', async () => {
    state.context = context('NHL', [realFa, prospectFa])
    state.waivers = waivers({
      unrankedProspects: [
        { playerId: 'fantrax:04qyh', playerName: 'Tyler Madden', position: 'RW', team: 'MIN' },
        { playerId: 'fantrax:04qyf', playerName: 'Cameron Hillis', position: 'C', team: null },
      ],
      prospectList: { total: 75, listed: 2 },
    })
    const result = await openWaivers()
    const html = result.innerHTML
    expect(screen.getByTestId('dynasty-war-room-prospect-badge-fantrax:04qyh').textContent).toBe('Prospect')
    expect(screen.getByTestId('dynasty-war-room-prospect-badge-fantrax:04qyf').textContent).toBe('Prospect')
    expect(screen.getByTestId('dynasty-war-room-prospect-unsigned-fantrax:04qyf').textContent).toBe('Unsigned')
    expect(screen.queryByTestId('dynasty-war-room-prospect-unsigned-fantrax:04qyh')).toBeNull()
    expect(html).toContain('MIN')
    expect(screen.getByText('Free NHL prospects (unranked)')).toBeTruthy()
    expect(screen.getByTestId('dynasty-war-room-prospects-hint').textContent).toBe(
      "Showing 2 of 75 free prospects. Find the rest by name in the league's free-agent list.",
    )
    // After the recommended adds, never among them.
    expect(html.indexOf('Real Center')).toBeLessThan(html.indexOf('Tyler Madden'))
    expect(html).not.toMatch(/\+ Tyler Madden/)
    // The "N FAs" count is the ranked pool.
    expect(screen.getByText(/1 FAs/)).toBeTruthy()
  })

  it('no hint when every free prospect is listed', async () => {
    state.context = context('NHL', [realFa, prospectFa])
    state.waivers = waivers({
      unrankedProspects: [{ playerId: 'fantrax:04qyf', playerName: 'Cameron Hillis', position: 'C', team: null }],
      prospectList: { total: 1, listed: 1 },
    })
    await openWaivers()
    expect(screen.getByTestId('dynasty-war-room-prospects')).toBeTruthy()
    expect(screen.queryByTestId('dynasty-war-room-prospects-hint')).toBeNull()
  })

  it('any other league: no prospect section at all', async () => {
    state.context = context('NBA', [realFa])
    state.waivers = waivers()
    const result = await openWaivers()
    expect(screen.queryByTestId('dynasty-war-room-prospects')).toBeNull()
    expect(result.innerHTML).not.toContain('Prospect')
  })
})
