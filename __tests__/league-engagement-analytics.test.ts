import { describe, expect, it, vi, afterEach } from 'vitest'
import { emitLeagueEngagementEvent } from '@/lib/league/league-engagement-analytics'

describe('emitLeagueEngagementEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches af-league-engagement on window', () => {
    const spy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true)
    emitLeagueEngagementEvent({ kind: 'predraft_cta_invite', leagueId: 'L1', surface: 'commissioner' })
    expect(spy).toHaveBeenCalled()
    const ev = spy.mock.calls[0][0] as CustomEvent
    expect(ev.type).toBe('af-league-engagement')
    expect((ev as CustomEvent).detail.kind).toBe('predraft_cta_invite')
  })
})
