import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { LineupIntelligenceActions } from '@/components/core-app/LineupIntelligenceActions'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'

afterEach(cleanup)
it('opens an unsent Decision OS lineup check scoped to the clicked league', () => {
  const events: unknown[] = []
  const listener = (event: Event) => events.push((event as CustomEvent).detail)
  window.addEventListener(COMMS_OPEN_EVENT, listener)
  try {
    render(<LineupIntelligenceActions leagueId="correct-league" leagueName="Sunday Dynasty" />)
    fireEvent.click(screen.getByRole('button', { name: "Ask Chimmy to check Sunday Dynasty's lineup" }))
    expect(events).toEqual([{ tab: 'chimmy', leagueId: 'correct-league', prefill: expect.stringContaining('Decision OS') }])
    expect((events[0] as any).prefill).toContain('exclude players whose games have started')
  } finally {
    window.removeEventListener(COMMS_OPEN_EVENT, listener)
  }
})
it('opens a roster review instead of a manual lineup check for Best Ball', () => {
 const events:any[]=[]
 const listener=(event:Event)=>events.push((event as CustomEvent).detail)
 window.addEventListener(COMMS_OPEN_EVENT,listener)
 try {
  render(<LineupIntelligenceActions leagueId="automatic" leagueName="Best Ball" bestBall />)
  fireEvent.click(screen.getByRole('button',{name:"Ask Chimmy to check Best Ball's Best Ball roster"}))
  expect(events[0].leagueId).toBe('automatic')
  expect(events[0].prefill).toContain('provider selects my scoring lineup automatically')
 } finally {window.removeEventListener(COMMS_OPEN_EVENT,listener)}
})