/**
 * "Plan with Chimmy" (components/core-app/WarPlanAsk.tsx) — the click, end to end in the DOM.
 *
 * Pins the prefill contract every Chimmy entry point on /core keeps: the click opens the comms drawer
 * on Chimmy, SCOPED TO THIS LEAGUE, with the war plan brief in the composer — and sends nothing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'

import { WarPlanAsk } from '@/components/core-app/WarPlanAsk'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from '@/components/core-app/comms/commsEvents'
import type { WarFrontCard } from '@/lib/core-app/warRoomFront'

const card: WarFrontCard = {
  leagueId: 'L1',
  leagueName: 'KBFL',
  posture: 'contender',
  horizon: 'this_season',
  format: 'redraft',
  odds: { playoff: 88, bye: 55, title: 19 },
  record: { wins: 7, losses: 2, ties: 0 },
  seed: 2,
  teams: 12,
  weeksRemaining: 4,
  orders: [],
  scoutHref: '/core/war-room?league=L1',
}

afterEach(() => cleanup())

describe('WarPlanAsk', () => {
  it('opens Chimmy on this league with the brief in the composer, and sends nothing', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const seen: CommsOpenDetail[] = []
    const listen = (e: Event) => seen.push((e as CustomEvent<CommsOpenDetail>).detail)
    window.addEventListener(COMMS_OPEN_EVENT, listen)

    render(<WarPlanAsk leagueId="L1" input={{ leagueName: 'KBFL', card, trades: null, format: null, nextSeason: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Chimmy with a war plan request for KBFL' }))

    window.removeEventListener(COMMS_OPEN_EVENT, listen)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.tab).toBe('chimmy')
    expect(seen[0]!.leagueId).toBe('L1')
    expect(seen[0]!.prefill).toContain('War plan for KBFL.')
    expect(seen[0]!.prefill).toContain('Situation: contender.')
    expect(seen[0]!.prefill).toContain('Odds: playoffs 88%, bye 55%, title 19%.')
    // A prefill, never a send: no request leaves the page.
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('reads as "Plan with Chimmy"', () => {
    render(<WarPlanAsk leagueId="L1" input={{ leagueName: 'KBFL', card: null, trades: null, format: null, nextSeason: null }} />)
    expect(screen.getByRole('button').textContent).toBe('Plan with Chimmy')
  })
})
