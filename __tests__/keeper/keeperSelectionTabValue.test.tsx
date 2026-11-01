import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { KeeperSelectionTab, keeperValueLine } from '@/app/league/[leagueId]/tabs/KeeperSelectionTab'

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
  it('formats a player above, at and below his cost', () => {
    expect(keeperValueLine({ marketRank: 10, pickSlot: 102, surplus: 92 })).toBe('+92 value · market #10, costs pick ~#102')
    expect(keeperValueLine({ marketRank: 30, pickSlot: 30, surplus: 0 })).toBe('Even value · market #30, costs pick ~#30')
    expect(keeperValueLine({ marketRank: 80, pickSlot: 30, surplus: -50 })).toBe('Worth 50 picks less than his cost · market #80, costs pick ~#30')
  })

  it('shows each candidate’s value when the league has the report', async () => {
    stub({ available: true, values: { p1: { marketRank: 10, pickSlot: 102, surplus: 92 }, p2: { marketRank: 80, pickSlot: 30, surplus: -50 } } })
    render(<KeeperSelectionTab leagueId="L" />)
    expect(await screen.findByText('+92 value · market #10, costs pick ~#102')).toBeTruthy()
    expect(screen.getByText(/Worth 50 picks less/)).toBeTruthy()
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
