import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChimmyBubble } from '@/components/decide/ChimmyBubble'
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => <div data-testid="shared-dock" /> }))
afterEach(cleanup)
describe('league communications dock', () => {
  it('forwards league Ask Chimmy prompts with their league scope', () => {
    const listener = vi.fn()
    window.addEventListener('af-comms-open', listener)
    render(<ChimmyBubble selectedLeague={null} activeLeagueId="league-1" userId="u1" />)
    window.dispatchEvent(new CustomEvent('af-chimmy-prefill', { detail: { prompt: '  Review my trade  ' } }))
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].detail).toEqual({ tab: 'chimmy', leagueId: 'league-1', prefill: 'Review my trade' })
    window.removeEventListener('af-comms-open', listener)
  })
})
