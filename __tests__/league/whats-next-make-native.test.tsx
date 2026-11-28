import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { WhatsNextPanel } from '@/components/league/whats-next/WhatsNextPanel'
import { MAKE_NATIVE_LABEL, makeNativeLeagueHref } from '@/lib/league/makeNativeLeague'

afterEach(() => cleanup())

/**
 * League home's "What's next?" card offers an imported league's commissioner the switch to AllFantasy — for the
 * commissioner only, and never on a native league. Since step 7 of the in-place conversion it leads to the switch card
 * in the league's own Commissioner tab, never to the retired copy flow (/create-league?fromLeague=, owner decision Q9).
 */
describe('"Make it a native league" on League home', () => {
  const league = { id: 'league/1', leagueType: 'redraft', format: 'redraft' } as never
  const imported = { platform: 'sleeper', sourceLeagueId: '998877', season: 2026, name: 'Going Deep', status: 'in_season' }

  it('links an imported league’s commissioner to the in-place switch, not the retired copy flow', () => {
    render(<WhatsNextPanel league={league} userId="u1" isCommissioner draftDateIso={null} onSelectTab={() => {}} imported={imported} />)
    const link = screen.getByTestId('whats-next-make-native')
    expect(link.textContent).toContain(MAKE_NATIVE_LABEL)
    expect(link.getAttribute('href')).toBe('/league/league%2F1?view=commissioner#native-switch')
    expect(link.getAttribute('href')).not.toContain('create-league')
    expect(screen.getByTestId('whats-next-make-native-note').textContent).toMatch(/same league on AllFantasy.*undo/)
  })

  it('is not offered to a manager who is not the commissioner', () => {
    render(<WhatsNextPanel league={league} userId="u2" isCommissioner={false} draftDateIso={null} onSelectTab={() => {}} imported={imported} />)
    expect(screen.getByTestId('whats-next')).toBeTruthy()
    expect(screen.queryByTestId('whats-next-make-native')).toBeNull()
    expect(screen.queryByTestId('whats-next-make-native-note')).toBeNull()
  })

  it('is not offered on a league that is already native', () => {
    render(<WhatsNextPanel league={{ id: 'n1', leagueType: 'redraft', format: 'redraft', status: 'pre_draft' } as never} userId="u1" isCommissioner draftDateIso={null} onSelectTab={() => {}} />)
    expect(screen.queryByTestId('whats-next-make-native')).toBeNull()
  })

  it('builds the same href everywhere it is offered', () => {
    expect(makeNativeLeagueHref('abc')).toBe('/league/abc?view=commissioner#native-switch')
  })
})
