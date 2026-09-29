import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { LineupIntelligenceActions } from '@/components/core-app/LineupIntelligenceActions'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'

afterEach(cleanup)
it('opens an unsent lineup check scoped to the clicked league, in the user’s own words', () => {
  const events: unknown[] = []
  const listener = (event: Event) => events.push((event as CustomEvent).detail)
  window.addEventListener(COMMS_OPEN_EVENT, listener)
  try {
    render(<LineupIntelligenceActions leagueId="correct-league" leagueName="Sunday Dynasty" />)
    fireEvent.click(screen.getByRole('button', { name: "Ask Chimmy to check Sunday Dynasty's lineup" }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ tab: 'chimmy', leagueId: 'correct-league' })
    const prefill = (events[0] as { prefill: string }).prefill
    /*
     * 🛑 THIS ASSERTION USED TO REQUIRE THE STRING "Decision OS", which is what kept internal
     * jargon in a message the USER sends as their own question. It now pins the two properties
     * that actually matter, so the copy can be improved without the test fighting it:
     */
    // 1. no internal system name reaches the composer
    expect(prefill).not.toMatch(/decision\s*os/i)
    // 2. the token `chimmyIntentRouter`'s NFL_RE matches survives, or the question routes elsewhere
    expect(prefill).toMatch(/\b(lineup|start|sit|roster)\b/i)
    expect(prefill).toContain('Sunday Dynasty')
    expect(prefill).toContain('exclude players whose games have started')
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
  expect(events[0].prefill).toContain('provider selects my scoring starters automatically')
  /*
   * ⚠ BOTH BRANCHES NEED THIS, AND ONLY ONE HAD IT. The start/sit test above pins "no internal
   * system name"; without the same line here the Best Ball prefill could keep (or regain) the
   * jargon with every test green — which is exactly what a mutation control caught: putting
   * "Decision OS" back into THIS branch changed nothing red.
   */
  expect(events[0].prefill).not.toMatch(/decision\s*os/i)
  expect(events[0].prefill).toMatch(/\b(lineup|start|sit|roster)\b/i)
 } finally {window.removeEventListener(COMMS_OPEN_EVENT,listener)}
})
