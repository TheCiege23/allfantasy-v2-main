import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChimmyBubble } from '@/components/decide/ChimmyBubble'
const dock = vi.hoisted(() => ({ props: null as any }))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: (props: any) => { dock.props = props; return <div data-testid="shared-dock" /> } }))
afterEach(cleanup)
describe('league communications dock', () => {
  it('passes the stored Sleeper id to the shared dock for provider deep links', () => {
    render(<ChimmyBubble userId="u1" selectedLeague={{ id: 'af-1', name: 'My league', platform: 'sleeper', sport: 'NFL', format: 'redraft', teamCount: 12, sleeperLeagueId: 'sleeper-123' }} />)
    expect(dock.props.leagues).toEqual([expect.objectContaining({ id: 'af-1', platformLeagueId: 'sleeper-123' })])
  })
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
