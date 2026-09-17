import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import React from 'react'

/**
 * An imported league's pick coverage has to survive two hand-offs: the hook copies the response
 * field by field (a new field is dropped unless it is named), and the Trade Center passes it to the
 * picker. Either miss makes a traded-only list read as "this team holds no picks".
 */

import { useLeagueRosters } from '@/components/core-app/screens/useLeagueRosters'

describe('useLeagueRosters keeps the coverage the route sent', () => {
  let original: typeof fetch
  beforeEach(() => {
    original = globalThis.fetch
    globalThis.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ rosters: [], viewerRosterId: null, viewerTeamRosterId: null, pickCoverage: 'traded_only' }) }) as Response,
    ) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = original
  })

  it('🛑 copies pickCoverage onto the data', async () => {
    const { result } = renderHook(() => useLeagueRosters('l1', true))
    await waitFor(() => expect(result.current.data?.pickCoverage).toBe('traded_only'))
  })
})

const rosterData = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/components/core-app/screens/useLeagueRosters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/core-app/screens/useLeagueRosters')>()
  return {
    ...actual,
    // The screen test drives the picker hand-off; the hook itself is exercised above.
    useLeagueRosters: (leagueId: string | null, enabled: boolean) =>
      rosterData.current === null ? actual.useLeagueRosters(leagueId, enabled) : { data: rosterData.current, state: 'idle' },
  }
})

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

describe('the Trade Center hands the coverage to the picker', () => {
  beforeEach(() => {
    rosterData.current = {
      rosters: [
        {
          rosterId: 'r1', platformUserId: 'u1', players: [], teamExternalId: '1', ownerName: 'You',
          avatarUrl: null, wins: 0, losses: 0, ties: 0, faabRemaining: null, canReceiveProposal: false,
          picks: [
            { pickId: 'fdp:2027:1:2', season: 2027, round: 1, label: '2027 1st (Bravo)', itemType: 'future_pick', value: 950, proposable: false, fromTeam: 'Bravo' },
          ],
        },
      ],
      viewerRosterId: null,
      viewerTeamRosterId: 'r1',
      pickCoverage: 'traded_only',
    }
  })
  afterEach(() => {
    rosterData.current = null
  })

  it('🛑 the picker says the list holds traded picks only', () => {
    render(<TradeCenter league={{ id: 'l1', name: 'Dynasty 101', format: 'Dynasty', teamCount: 10 }} />)
    fireEvent.click(screen.getAllByText('+ Add asset')[0]!)
    const picker = document.querySelector('.af-tc-picker') as HTMLElement
    fireEvent.click(within(picker).getByText('Pick'))
    const text = (picker.textContent ?? '').replace(/\s+/g, ' ')
    expect(text).toContain('2027 1st (Bravo)')
    expect(text).toContain('Only picks that have changed hands are listed')
  })
})
