/**
 * Keeper War Room: readable in light mode, and in plain words (2026-11-22, keeper audit items 1 and 7).
 *
 * The panel was hard-coded dark Tailwind. In light mode app/globals.css turns every `text-white*` class dark, but
 * lightens only some `bg-[#…]` backgrounds — so the title, the tool buttons and the Ask box went dark on dark. The
 * panel now draws from tokens (keeper-surfaces.css), so neither class family appears in it.
 *
 * It also printed its rules as code ("max 3 · round based · −1 rd · 3yr max", "ADP ✓ · costs ✓ · elig ✓"), shouted
 * KEEP / BUBBLE / AVOID, wrote "+8rd", and asked the user to TYPE an "Incoming player ID" for a trade.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const player = (id: string, name: string, position: string, extra: Record<string, unknown> = {}) => ({
  playerId: id, playerName: name, position, team: 'X', slotType: 'bench', isStarterSlot: false, isKept: false, injuryStatus: null,
  adp: null, adpRound: null, isEligible: true, ineligibleReason: null, yearsKept: 0, keeperCostRound: null, keeperCostAuction: null,
  keeperCostLabel: null, surplusRounds: null, surplusAuction: null, weekProjection: null, seasonAvgActual: null, ...extra,
})
const availability = Object.fromEntries(
  ['scoringRules', 'rosterRules', 'standings', 'schedule', 'rosters', 'playerValues', 'keeperRules', 'keeperCosts', 'eligibility', 'projections', 'injuries', 'news', 'freeAgentPool']
    .map((k) => [k, k === 'keeperCosts' ? 'missing' : 'available']),
)
const STATE = {
  context: {
    leagueId: 'L', leagueType: 'keeper', sport: 'NFL', season: 2027, teamCount: 12, currentWeek: 0, totalWeeks: 17,
    seasonStatus: 'offseason', seasonActive: false,
    scoring: { sport: 'NFL', scoringPreset: 'Half PPR', pointsPerReception: 0.5, superflex: false, tePremium: false },
    roster: { totalStarterSlots: 9, benchSlots: 6, irSlots: 1, requiredByPosition: {} },
    keeper: { maxKeepers: 3, maxYears: 3, costSystem: 'round_based', roundPenalty: 1, auctionPctIncrease: 0, waiverAllowed: true, selectionDeadline: null, keeperPhaseActive: true, draftRounds: 15 },
    userRosterId: 'r1', isCommissioner: false,
    teams: [
      { rosterId: 'r1', ownerId: 'u1', ownerName: 'You', teamName: 'Mine', isUserTeam: true, players: [player('p-puka', 'Puka Nacua', 'WR')] },
      { rosterId: 'r2', ownerId: 'u2', ownerName: 'Sam', teamName: 'Gridiron Gang', isUserTeam: false, players: [player('p-chase', "Ja'Marr Chase", 'WR')] },
    ],
    freeAgents: [], availability,
    freshness: { generatedAt: '2027-08-01T00:00:00Z', statsAsOf: null, projectionsAsOf: null, injuriesAsOf: null },
    missingDataFlags: [], featureAvailability: {},
  },
  recommendations: {
    rosterId: 'r1', maxKeepers: 3, needsMoreData: false, missingDataFlags: [], ranked: [],
    recommended: [{ playerId: 'p-puka', playerName: 'Puka Nacua', position: 'WR', verdict: 'definite_keep', surplusRounds: 8, keeperCostLabel: 'Round 9', reason: 'x' }],
    bubble: [{ playerId: 'p-j', playerName: 'Josh Jacobs', position: 'RB', verdict: 'borderline', surplusRounds: 0, keeperCostLabel: null, reason: 'About what he costs' }],
    avoid: [{ playerId: 'p-k', playerName: 'Travis Kelce', position: 'TE', verdict: 'let_go', surplusRounds: -2, keeperCostLabel: null, reason: 'Costs a 4th' }],
  },
  needs: { rosterId: 'r1', keptByPosition: {}, needs: [{ position: 'RB', severity: 'high' }], strengths: ['WR'], draftTargetPositions: ['RB'], explanationFacts: [], missingDataFlags: [] },
}

const analyze = vi.fn(async () => ({ tradeAnalysis: { explanationFacts: [], keeperImpact: [], riskFlags: [] }, tradeGrade: null }))
vi.mock('@/lib/keeper-war-room/client', () => ({
  fetchKeeperWarRoomState: vi.fn(async () => STATE),
  fetchKeeperCutList: vi.fn(async () => ({ cutList: { cutList: [], riskFlags: [] } })),
  fetchKeeperDraftPlan: vi.fn(async () => ({ draftPlan: { consumedRounds: [], remainingRounds: [], totalRounds: 15, roundPlan: [], missingDataFlags: [] } })),
  fetchKeeperWaivers: vi.fn(), fetchKeeperLineup: vi.fn(), findKeeperWarRoomTrades: vi.fn(),
  analyzeKeeperWarRoomTrade: (...a: unknown[]) => (analyze as (...x: unknown[]) => unknown)(...a),
  askKeeperWarRoom: vi.fn(),
}))
vi.mock('@/app/league/[leagueId]/tabs/WarRoomTradeGradeLine', () => ({ WarRoomTradeGradeLine: () => null }))

import { KeeperWarRoomPanel } from '@/app/league/[leagueId]/tabs/keeper/KeeperWarRoomPanel'

afterEach(cleanup)

async function panel() {
  render(<KeeperWarRoomPanel leagueId="L" />)
  return screen.findByTestId('keeper-war-room-panel')
}

describe('Keeper War Room is readable in light mode', () => {
  it('uses no class the global light-mode rule rewrites (text-white*, bg-[#hex])', async () => {
    const el = await panel()
    const offenders = [el, ...Array.from(el.querySelectorAll('*'))]
      .map((n) => n.getAttribute('class') ?? '')
      .filter((c) => /text-white|bg-\[#|placeholder:text-white/.test(c))
    expect(offenders).toEqual([])
  })

  it('keeps every tool button labelled', async () => {
    const el = await panel()
    for (const t of ['cut-list', 'draft-plan', 'trade-analyze', 'trade-find']) {
      expect(within(el).getByTestId(`keeper-war-room-tool-${t}`).textContent?.trim()).not.toBe('')
    }
  })
})

describe('Keeper War Room speaks plainly', () => {
  it('states the keeper rules in words, not codes', async () => {
    const card = within(await panel()).getByTestId('keeper-war-room-rules-card')
    expect(card.textContent).toMatch(/Keep up to 3 players/)
    expect(card.textContent).toMatch(/one round earlier/i)
    expect(card.textContent).toMatch(/up to 3 seasons/i)
    expect(card.textContent).not.toMatch(/−1 rd|yr max|round_based|round based|✓|elig\b/)
  })

  it('names only the data that is missing', async () => {
    const card = within(await panel()).getByTestId('keeper-war-room-rules-card')
    expect(card.textContent).toMatch(/Keeper costs aren’t set yet/)
  })

  it('labels advice in sentence case and spells out the value', async () => {
    const recs = within(await panel()).getByTestId('keeper-war-room-recommendations')
    expect(recs.textContent).not.toMatch(/\bKEEP\b|\bBUBBLE\b|\bAVOID\b|\+\d+rd/)
    expect(recs.textContent).toMatch(/8 rounds of value/)
    expect(recs.textContent).toMatch(/On the bubble/)
    expect(recs.textContent).toMatch(/Let go/)
  })

  it('asks Chimmy, not "AF Legacy"', async () => {
    const el = await panel()
    expect(el.textContent).toMatch(/Ask Chimmy/)
    expect(el.textContent).not.toMatch(/Ask AF Legacy/)
  })
})

describe('Keeper trade analyzer picks the incoming player from a list', () => {
  it('offers the other teams’ players, and sends the picked id', async () => {
    const el = await panel()
    fireEvent.click(within(el).getByTestId('keeper-war-room-tool-trade-analyze'))
    const incoming = await within(el).findByTestId('keeper-war-room-trade-incoming-select')
    expect(incoming.tagName).toBe('SELECT')
    expect(within(el).queryByPlaceholderText(/player ID/i)).toBeNull()
    expect(within(incoming).getByRole('option', { name: /Ja'Marr Chase/ })).toBeTruthy()
    expect(within(incoming).queryByRole('option', { name: /Puka Nacua/ })).toBeNull()
    fireEvent.change(incoming, { target: { value: 'p-chase' } })
    fireEvent.click(within(el).getByTestId('keeper-war-room-trade-analyze-submit'))
    await waitFor(() => expect(analyze).toHaveBeenLastCalledWith('L', expect.objectContaining({ incomingPlayerIds: ['p-chase'] })))
  })

  it('opening the analyzer sends nothing; grading waits for an incoming player', async () => {
    analyze.mockClear()
    const el = await panel()
    fireEvent.click(within(el).getByTestId('keeper-war-room-tool-trade-analyze'))
    await within(el).findByTestId('keeper-war-room-trade-incoming-select')
    expect(analyze).not.toHaveBeenCalled()
    expect((within(el).getByTestId('keeper-war-room-trade-analyze-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a failed tool reports under the buttons and leaves the panel standing', async () => {
    analyze.mockRejectedValueOnce(new Error('Trade service is down.'))
    const el = await panel()
    fireEvent.click(within(el).getByTestId('keeper-war-room-tool-trade-analyze'))
    fireEvent.change(await within(el).findByTestId('keeper-war-room-trade-incoming-select'), { target: { value: 'p-chase' } })
    fireEvent.click(within(el).getByTestId('keeper-war-room-trade-analyze-submit'))
    expect((await screen.findByTestId('keeper-war-room-tool-error')).textContent).toMatch(/Trade service is down/)
    expect(screen.getByTestId('keeper-war-room-panel')).toBeTruthy()
    expect(screen.queryByTestId('keeper-war-room-error')).toBeNull()
  })
})
