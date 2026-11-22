/**
 * Owner report from a hosted NFL league, 2026-11-22:
 *  - the free-agent list identified players by an internal pool id, while drafted rosters, scoring
 *    and the player card use the Sleeper id (a team defense: its club code);
 *  - the add sheet's buttons sat under the league's tab bar, and its drop list showed raw ids.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/core-app/unsavedWork', () => ({ useHoldUnsavedWork: () => {} }))

import { nflRosterIdForPoolRow } from '@/lib/waiver-wire/nflRosterIdForPoolRow'
import WaiverClaimDrawer from '@/components/waiver-wire/WaiverClaimDrawer'

describe('nflRosterIdForPoolRow', () => {
  it("uses the row's Sleeper id for an NFL player", () => {
    expect(nflRosterIdForPoolRow('NFL', { player_id: 'f3ea3309-de5c-4f90-a8c1-d83fdaf144d7', sleeper_id: '96' })).toBe('96')
    expect(nflRosterIdForPoolRow('nfl', { player_id: 'x', sleeper_id: 6904 })).toBe('6904')
  })

  it("uses the club code for a team defense", () => {
    expect(nflRosterIdForPoolRow('NFL', { player_id: 'nfl:def:KC', sleeper_id: null })).toBe('KC')
    expect(nflRosterIdForPoolRow('NFL', { player_id: 'nfl:def:was' })).toBe('WAS')
  })

  it('keeps the pool id where the roster id is not known for certain', () => {
    expect(nflRosterIdForPoolRow('NFL', { player_id: 'f3ea3309', sleeper_id: null })).toBeNull()
    expect(nflRosterIdForPoolRow('NFL', { player_id: 'f3ea3309', sleeper_id: 'tsdb_34149903' })).toBeNull()
    expect(nflRosterIdForPoolRow('NFL', null)).toBeNull()
  })

  it('changes nothing for another sport', () => {
    expect(nflRosterIdForPoolRow('NBA', { player_id: 'abc', sleeper_id: '96' })).toBeNull()
  })
})

describe('WaiverClaimDrawer', () => {
  const player = { id: '96', name: 'Aaron Rodgers', position: 'QB', team: 'PIT' }
  const roster = [{ id: '6904', name: 'Jalen Hurts' }, { id: '4034', name: null }]
  const base = { open: true, onClose: () => {}, player, faabMode: false, faabRemaining: null, rosterPlayerIds: ['6904', '4034'], rosterPlayers: roster }

  it('lists drop choices by name, never by raw id beside a name', () => {
    render(<WaiverClaimDrawer {...base} onSubmit={() => {}} />)
    expect(screen.getByRole('option', { name: 'Jalen Hurts' })).toBeTruthy()
    expect(screen.queryByText(/Jalen Hurts \(6904\)/)).toBeNull()
    // No name on file: the id is the only thing there is to show.
    expect(screen.getByRole('option', { name: '4034' })).toBeTruthy()
  })

  it('a free-agent add with a full roster asks for the drop, hides claim order, and adds on confirm', async () => {
    const onSubmit = vi.fn()
    render(<WaiverClaimDrawer {...base} immediate hasOpenRosterSpot={false} onSubmit={onSubmit} />)
    // The sheet's label and, until a drop is chosen, its button.
    expect(screen.getAllByText('Add player')).toHaveLength(2)
    expect(screen.getByText('Your roster is full. Choose a player to drop')).toBeTruthy()
    expect(screen.queryByTestId('waiver-claim-priority-input')).toBeNull()
    const submit = screen.getByTestId('waiver-claim-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('waiver-drop-player-selector'), { target: { value: '6904' } })
    expect(screen.getByTestId('waiver-claim-summary').textContent).toBe('Add Aaron Rodgers · drop Jalen Hurts')
    expect(submit.disabled).toBe(false)
    expect(submit.textContent).toBe('Add and drop')
    fireEvent.click(submit)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ dropPlayerId: '6904', faabBid: null, priorityOrder: null }))
  })

  it('a waiver claim keeps its claim order and FAAB bid', () => {
    render(<WaiverClaimDrawer {...base} faabMode faabRemaining={100} onSubmit={() => {}} />)
    expect(screen.getByText('Waiver claim')).toBeTruthy()
    expect(screen.getByTestId('waiver-claim-priority-input')).toBeTruthy()
    expect(screen.getByTestId('waiver-faab-bid-input')).toBeTruthy()
    expect(screen.getByTestId('waiver-claim-submit').textContent).toBe('Confirm claim')
  })

  it('sits above the league tab bar', () => {
    render(<WaiverClaimDrawer {...base} onSubmit={() => {}} />)
    expect(screen.getByTestId('waiver-claim-drawer').className).toContain('z-[1200]')
  })
})
