import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { LeagueCalls } from '@/components/core-app/player-finder/LeagueCalls'
import type { LeagueCall } from '@/lib/core-app/leagueCall'

/* Phase 3a: the start/sit call, league by league, with Ask Chimmy scoped to each league. */

const swap = { startId: 'kraft', startName: 'Tucker Kraft', benchId: 'kincaid', benchName: 'Dalton Kincaid' }
const CALLS: LeagueCall[] = [
  { leagueId: 'L1', leagueName: 'KBFL', platform: 'sleeper', kind: 'hold', tone: 'good', headline: 'Keep him in', why: 'Nobody on your bench out-projects him here.', swap: null },
  { leagueId: 'L2', leagueName: 'Four Horsemen', platform: 'sleeper', kind: 'locked', tone: 'none', headline: 'Locked', why: 'His game kicked off.', swap: null },
  { leagueId: 'L3', leagueName: 'Going Deep', platform: 'sleeper', kind: 'hold', tone: 'warn', headline: 'Keep him in — have Tucker Kraft ready', why: 'He is questionable…', swap },
  { leagueId: 'L4', leagueName: 'The League', platform: 'espn', kind: 'sit', tone: 'bad', headline: 'Sit him — start Tucker Kraft', why: 'He is ruled out.', swap },
]

describe('LeagueCalls', () => {
  it('puts what needs you first: sit, start, a questionable hold, a settled hold, then locked', () => {
    render(<LeagueCalls calls={CALLS} playerName="Dalton Kincaid" />)
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.af-pf-call-league')?.textContent)).toEqual(['The League', 'Going Deep', 'KBFL', 'Four Horsemen'])
    expect(screen.getByRole('region', { name: 'Your call, league by league' })).toHaveTextContent('Sit him — start Tucker Kraft')
  })

  it('Ask Chimmy opens the drawer scoped to THAT league with the question typed in — it does not send', () => {
    const seen: unknown[] = []
    const onOpen = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener(COMMS_OPEN_EVENT, onOpen)
    render(<LeagueCalls calls={[CALLS[2]]} playerName="Dalton Kincaid" />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask Chimmy' }))
    window.removeEventListener(COMMS_OPEN_EVENT, onOpen)
    expect(seen).toEqual([{ tab: 'chimmy', prefill: 'In Going Deep: Dalton Kincaid is questionable — should I keep him in or start Tucker Kraft?', leagueId: 'L3' }])
  })

  it('renders nothing with no leagues', () => {
    const { container } = render(<LeagueCalls calls={[]} playerName="X" />)
    expect(container.innerHTML).toBe('')
  })
})
