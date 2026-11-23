/**
 * League screens: a player's name opens the shared player card, and the players list leaves out
 * anyone the feed marks inactive. (Owner report, 2026-11-22: no card opened anywhere in a hosted
 * league, and a retired quarterback sat in the free-agent list.)
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const open = vi.hoisted(() => vi.fn())
vi.mock('@/components/core-app/player-card/PlayerCardProvider', () => ({
  usePlayerCard: () => ({ open, close: () => {}, isOpen: false }),
}))

import { PlayerNameButton, useNativePlayerCard } from '@/components/league/native/screens/NativeScreenParts'
import { isInactiveWirePlayer } from '@/components/league/native/screens/NativeWaiversScreen'

function Row({ sport, id }: { sport: string; id: string }) {
  const openCard = useNativePlayerCard(sport)
  return (
    <PlayerNameButton name="Jalen Hurts" onOpen={() => openCard({ id, name: 'Jalen Hurts', position: 'QB', team: 'PHI' })}>
      Jalen Hurts
    </PlayerNameButton>
  )
}

describe('a player name on a league screen', () => {
  it('opens the card by Sleeper id for an NFL league', () => {
    open.mockClear()
    render(<Row sport="nfl" id="6904" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Jalen Hurts player card' }))
    expect(open).toHaveBeenCalledWith({ sport: 'NFL', sleeperId: '6904', name: 'Jalen Hurts', position: 'QB', team: 'PHI', imageUrl: null })
  })

  it("opens it by the feed's own id for another sport", () => {
    open.mockClear()
    render(<Row sport="NBA" id="nba-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Jalen Hurts player card' }))
    expect(open.mock.calls[0][0]).toMatchObject({ sport: 'NBA', externalId: 'nba-1' })
    expect(open.mock.calls[0][0]).not.toHaveProperty('sleeperId')
  })

  it('does nothing for a row with no player id', () => {
    open.mockClear()
    render(<Row sport="NFL" id="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Jalen Hurts player card' }))
    expect(open).not.toHaveBeenCalled()
  })
})

describe('isInactiveWirePlayer', () => {
  it.each(['INA', 'Inactive', 'retired', ' ina '])('leaves out %s', (status) => {
    expect(isInactiveWirePlayer({ injuryStatus: status })).toBe(true)
  })
  it.each([null, undefined, '', 'Questionable', 'IR', 'Out', 'Active'])('keeps %s', (status) => {
    expect(isInactiveWirePlayer({ injuryStatus: status })).toBe(false)
  })
})
