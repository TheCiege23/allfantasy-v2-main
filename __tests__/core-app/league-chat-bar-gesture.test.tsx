import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LeagueChatBar } from '@/components/core-app/LeagueChatBar'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'

it('opens league chat once when iOS follows a swipe with a click', () => {
  const listener = vi.fn()
  window.addEventListener(COMMS_OPEN_EVENT, listener)
  try {
    render(<LeagueChatBar leagueId="league-1" leagueName="Sunday Legends" preview={null} />)
    const button = screen.getByRole('button', { name: 'Open Sunday Legends chat' })
    fireEvent.touchStart(button, { touches: [{ clientY: 180 }] })
    fireEvent.touchEnd(button, { changedTouches: [{ clientY: 130 }] })
    fireEvent.click(button)
    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: 'league', leagueId: 'league-1' })
  } finally {
    window.removeEventListener(COMMS_OPEN_EVENT, listener)
  }
})
