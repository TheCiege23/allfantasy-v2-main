import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Board } from '@/components/core-app/screens/DraftBoard'
import { ContextHelp } from '@/components/core-app/ContextHelp'
vi.mock('@/components/core-app/draft-music/DraftMusicWidget', () => ({ default: () => null }))
const columns = [{ slot: 1, rosterId: 'a', displayName: 'Alpha', isYours: true }, { slot: 2, rosterId: 'b', displayName: 'Beta', isYours: false }]
const cells = [1, 2].map((overall) => ({ overall, round: 1, pickInRound: overall, originalSlot: overall,
  label: `1.0${overall}`, rosterId: 'a', ownerName: 'Alpha', playerName: `Player ${overall}`, position: 'WR', isYours: true, isOnTheClock: false }))
describe('Draft HQ board', () => {
  it('keeps both picks when one manager acquires another pick in the same round', () => {
    render(<Board columns={columns} cells={cells} rounds={3} draftType="snake" thirdRoundReversal={false} />)
    expect(screen.getByText('Player 1')).toBeTruthy()
    expect(screen.getByText('Player 2')).toBeTruthy()
    const firstRound = screen.getByText('R1').closest('tr')!
    expect(within(firstRound.children[2] as HTMLElement).getByText('Traded · Alpha')).toBeTruthy()
    expect(screen.getByText('R3')).toBeTruthy()
  })
  it('shows the future board before any selections are made', () => {
    render(<Board columns={columns} cells={[]} rounds={3} draftType="snake" thirdRoundReversal={true} />)
    const thirdRound = screen.getByText('R3').closest('tr')!
    expect(thirdRound.children[1].textContent).toBe('3.02')
    expect(thirdRound.children[2].textContent).toBe('3.01')
  })
  it('keeps auction selections in a list instead of placing bids in a snake grid', () => {
    render(<Board columns={columns} cells={cells} rounds={3} draftType="auction" thirdRoundReversal={false} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('table')).toBeNull()
  })
})
describe('Circled question mark explanations', () => {
  it('opens on hover and dismisses on leaving', async () => {
    render(<ContextHelp title="ADP" body="Average draft position." />)
    const button = screen.getByRole('button', { name: 'About ADP' })
    fireEvent.mouseEnter(button)
    expect(screen.getByText('Average draft position.')).toBeTruthy()
    fireEvent.mouseLeave(button)
    await waitFor(() => expect(screen.queryByText('Average draft position.')).toBeNull())
  })
  it('pins on touch/click and closes explicitly', () => {
    render(<ContextHelp title="ADP" body="Average draft position." />)
    const button = screen.getByRole('button', { name: 'About ADP' })
    fireEvent.click(button)
    fireEvent.mouseLeave(button)
    expect(screen.getByText('Average draft position.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close explanation for ADP' }))
    expect(screen.queryByText('Average draft position.')).toBeNull()
  })
  it('opens on keyboard focus and closes on Escape', () => {
    render(<ContextHelp title="ADP" body="Average draft position." />)
    fireEvent.focus(screen.getByRole('button', { name: 'About ADP' }))
    expect(screen.getByText('Average draft position.')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Average draft position.')).toBeNull()
  })
})
