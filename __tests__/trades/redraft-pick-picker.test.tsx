import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, renderHook, waitFor } from '@testing-library/react'

/**
 * The trade builder in a REDRAFT league: this season's picks for both sides, offerable; future picks
 * not offered, with the reason on screen. The hook must copy `pickPolicy` (it copies the response
 * field by field), and the picker must pin the hand-entry year to the current draft's season.
 */

import { useLeagueRosters, type TradePickPolicy } from '@/components/core-app/screens/useLeagueRosters'
import { TradeAssetPicker } from '@/components/core-app/screens/TradeAssetPicker'

const REDRAFT_POLICY: TradePickPolicy = {
  mode: 'redraft_current_draft',
  season: 2026,
  futurePicksAllowed: false,
  futurePicksReason: 'Future draft picks cannot be traded in a redraft league. Only picks in this season’s draft can be traded.',
  draftClosedReason: null,
}

describe('useLeagueRosters keeps the pick policy the route sent', () => {
  let original: typeof fetch
  beforeEach(() => {
    original = globalThis.fetch
    globalThis.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ rosters: [], viewerRosterId: null, viewerTeamRosterId: null, pickPolicy: REDRAFT_POLICY }) }) as Response,
    ) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = original
  })

  it('copies pickPolicy onto the data', async () => {
    const { result } = renderHook(() => useLeagueRosters('l1', true))
    await waitFor(() => expect(result.current.data?.pickPolicy).toEqual(REDRAFT_POLICY))
  })
})

describe('the picker in a redraft league', () => {
  const pick = {
    pickId: 'rdp:ds-1:1:ra', season: 2026, round: 1, label: '2026 Round 1, Pick 1',
    itemType: 'rookie_pick' as const, value: null, proposable: true, fromTeam: null,
  }

  function open(policy: TradePickPolicy | null, onPick = vi.fn()) {
    const ui = render(
      <TradeAssetPicker onClose={() => {}} onPick={onPick} rosterKnown rosterPicks={[pick]} pickPolicy={policy} />,
    )
    fireEvent.click(ui.getByRole('button', { name: 'Pick' }))
    return ui
  }

  it('offers the current-season pick as proposable', () => {
    const onPick = vi.fn()
    const ui = open(REDRAFT_POLICY, onPick)
    fireEvent.click(ui.getByRole('button', { name: /2026 Round 1, Pick 1/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ pickId: 'rdp:ds-1:1:ra', itemType: 'rookie_pick', proposable: true }))
  })

  it('says why future picks are not offered, and pins the hand-entry year to the current season', () => {
    const ui = open(REDRAFT_POLICY)
    expect(ui.getByTestId('trade-picker-future-picks-reason').textContent).toContain('Future draft picks cannot be traded in a redraft league')
    const year = ui.getByRole('spinbutton', { name: 'Year' }) as HTMLInputElement
    expect(year.value).toBe('2026')
    expect(year.disabled).toBe(true)
  })

  it('a dynasty league keeps the open year field and shows no redraft reason', () => {
    const ui = open({ mode: 'standard', season: 2026, futurePicksAllowed: true, futurePicksReason: null, draftClosedReason: null })
    expect(ui.queryByTestId('trade-picker-future-picks-reason')).toBeNull()
    expect((ui.getByRole('spinbutton', { name: 'Year' }) as HTMLInputElement).disabled).toBe(false)
  })

  it('after the draft, says there are no picks left rather than an empty list', () => {
    const ui = render(
      <TradeAssetPicker onClose={() => {}} onPick={vi.fn()} rosterKnown rosterPicks={[]}
        pickPolicy={{ ...REDRAFT_POLICY, draftClosedReason: 'This season’s draft is complete — there are no picks left to trade.' }} />,
    )
    fireEvent.click(ui.getByRole('button', { name: 'Pick' }))
    expect(ui.getByText(/draft is complete — there are no picks left to trade/)).toBeTruthy()
  })
})
