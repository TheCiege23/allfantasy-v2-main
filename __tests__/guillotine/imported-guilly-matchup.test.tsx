/**
 * An imported Guilly league's Matchup tab is the survival board, read from the provider's scores — not the
 * head-to-head matchup center, which a Guilly league does not have.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportedGuillyMatchup } from '@/app/league/[leagueId]/tabs/ImportedGuillyMatchup'

const body = {
  platform: 'sleeper',
  myRosterId: '2',
  check: { status: 'ok', attention: 0, format: 'confirmed' },
  lastReadAt: null,
  view: {
    week: 11,
    standings: [
      { rosterId: '1', name: 'Chop till you drop', points: 106.36, onChopLine: false, tier: 'safe' },
      { rosterId: '2', name: 'Team TheCiege24', points: 65.94, onChopLine: false, tier: 'safe' },
      { rosterId: '3', name: 'HoldtheDoor', points: 63.06, onChopLine: true, tier: 'chop_zone' },
    ],
    chopped: [{ rosterId: '4', name: 'Team JukeyDukey86', week: 10 }],
    teamsAlive: 3,
    scoredThisWeek: 3,
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('imported Guilly matchup tab', () => {
  it('🛑 shows you against the league and the chop line, from the provider scores', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(u); return new Response(JSON.stringify(body)) }))
    const open = vi.fn()
    render(<ImportedGuillyMatchup leagueId="L1" onOpenGuilly={open} />)
    expect((await screen.findByTestId('gsb-headline')).textContent).toBe('Safe by 2.9')
    expect(calls).toEqual(['/api/leagues/L1/guillotine/imported'])
    expect(screen.getByTestId('gsb-chop-line').parentElement?.textContent).toContain('HoldtheDoor')
    expect(screen.getByText(/Scores from Sleeper, which runs the chop/)).toBeTruthy()
    expect(screen.getByTestId('gsb-graveyard').textContent).toContain('Team JukeyDukey86')
    fireEvent.click(screen.getByRole('button', { name: 'Guilly details' }))
    expect(open).toHaveBeenCalled()
  })

  it('says so when the standings cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not an imported Guilly league' }), { status: 404 })))
    render(<ImportedGuillyMatchup leagueId="L1" />)
    expect((await screen.findByRole('alert')).textContent).toBe('Not an imported Guilly league')
  })
})
