import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { KeeperSelectionTab, keeperRefusalText, keeperValueLine } from '@/app/league/[leagueId]/tabs/KeeperSelectionTab'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function stub(valueReport: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.includes('/api/keeper/context')
      ? { league: { keeperCount: 3 }, session: { id: 's', seasonId: 'S', status: 'open', deadline: new Date(Date.now() + 864e5).toISOString(), teamsSubmitted: 0, totalTeams: 12 }, viewerRoster: { id: 'R', seasonId: 'S' } }
      : url.includes('/api/keeper/eligibility')
        ? { raw: [{ playerId: 'p1', isEligible: true, ineligibleReason: null, projectedCost: 'Round 9', projectedCostRound: 9, yearsKept: 0 }, { playerId: 'p2', isEligible: true, ineligibleReason: null, projectedCost: 'Round 3', projectedCostRound: 3, yearsKept: 0 }], valueReport }
        : url.includes('/api/redraft/roster')
          ? { roster: { players: [{ playerId: 'p1', playerName: 'Star Guy', position: 'WR' }, { playerId: 'p2', playerName: 'Bust Guy', position: 'RB' }] } }
          : { records: [] }
    return { ok: true, json: async () => body }
  }))
}

describe('keeper screen — value report', () => {
  // In rounds, as the War Room says it (2026-11-24): the cost round is on the card's line above, so not repeated.
  it('formats a player above, at and below his cost', () => {
    expect(keeperValueLine({ marketRank: 10, pickSlot: 102, surplus: 92 }, 9, 12)).toEqual({ text: '8 rounds of value · usually goes in round 1', tone: 'good' })
    expect(keeperValueLine({ marketRank: 30, pickSlot: 30, surplus: 0 }, 3, 12)).toEqual({ text: 'About what he costs · usually goes in round 3', tone: 'even' })
    expect(keeperValueLine({ marketRank: 80, pickSlot: 30, surplus: -50 }, 3, 12)).toEqual({ text: "Costs 4 rounds more than he's worth · usually goes in round 7", tone: 'bad' })
    expect(keeperValueLine({ marketRank: 13, pickSlot: 24, surplus: 11 }, 3, 12).text).toBe('1 round of value · usually goes in round 2')
  })

  it('shows each candidate’s value when the league has the report', async () => {
    stub({ available: true, values: { p1: { marketRank: 10, pickSlot: 102, surplus: 92 }, p2: { marketRank: 80, pickSlot: 30, surplus: -50 } } })
    render(<KeeperSelectionTab leagueId="L" />)
    expect(await screen.findByText('8 rounds of value · usually goes in round 1')).toBeTruthy()
    expect(screen.getByText(/Costs 4 rounds more than he's worth/)).toBeTruthy()
    expect(screen.getByTestId('keeper-value-note')).toBeTruthy()
  })

  it('shows nothing extra when it does not', async () => {
    stub({ available: false, reason: 'not_entitled' })
    render(<KeeperSelectionTab leagueId="L" />)
    await screen.findByText('Star Guy')
    expect(screen.queryByTestId('keeper-value')).toBeNull()
    expect(screen.queryByTestId('keeper-value-note')).toBeNull()
  })
})

describe('keeperRefusalText', () => {
  const nameOf = (id: string) => ({ a: 'Josh Allen', b: 'Bijan Robinson' } as Record<string, string>)[id] ?? ''
  it('says why in words, with the players named', () => {
    expect(keeperRefusalText({ playerIds: ['a', 'b'], reason: 'duplicate_round_5' }, nameOf)).toBe('Josh Allen and Bijan Robinson both cost a round 5 pick. Keep one, or ask your commissioner how the league settles it.')
    expect(keeperRefusalText({ playerIds: ['a'], reason: 'rejected_by_commissioner' }, nameOf)).toBe('Josh Allen: your commissioner rejected this keeper.')
    expect(keeperRefusalText({ playerIds: ['a'], reason: 'max_years_reached' }, nameOf)).toBe('Josh Allen has been kept the most seasons your league allows.')
    expect(keeperRefusalText({ playerIds: ['a'], reason: 'not_on_roster' }, nameOf)).toBe('Josh Allen is not on your roster.')
  })
  it('an unknown code or an unknown player still reads as a sentence, never as a code', () => {
    expect(keeperRefusalText({ playerIds: ['zzz'], reason: 'some_new_code' }, nameOf)).toBe('This player is not eligible to be kept.')
    expect(keeperRefusalText({ reason: 'ineligible' }, nameOf)).toBe('This player is not eligible to be kept.')
  })
})
