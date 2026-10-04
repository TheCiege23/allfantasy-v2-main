import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Board } from '@/components/core-app/screens/DraftBoard'
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
