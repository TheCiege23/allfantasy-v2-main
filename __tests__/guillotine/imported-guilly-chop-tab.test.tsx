/**
 * An imported Guilly league's Chop tab is the survival board, read from the provider's scores: the one page for
 * "who is getting chopped". It was two tabs (a plain standings list, and this board); the list is gone.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportedGuillyTab } from '@/app/league/[leagueId]/tabs/ImportedGuillyTab'

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
  outlook: {
    '1': { playersLeft: 0, starters: 9, gamesLeft: 0, remainingProjection: 0, partial: false },
    '2': { playersLeft: 3, starters: 9, gamesLeft: 3, remainingProjection: 25, partial: false },
    '3': { playersLeft: 1, starters: 9, gamesLeft: 1, remainingProjection: 6, partial: false },
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('imported Guilly Chop tab', () => {
  it('🛑 shows you against the league and the chop line, from the provider scores', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(u); return new Response(JSON.stringify(body)) }))
    render(<ImportedGuillyTab leagueId="L1" />)
    expect((await screen.findByTestId('gsb-headline')).textContent).toBe('Safe by 2.9')
    expect(calls).toEqual(['/api/leagues/L1/guillotine/imported?outlook=1'])
    expect(screen.getByTestId('gsb-chop-line').parentElement?.textContent).toContain('HoldtheDoor')
    expect(screen.getByText(/Scores from Sleeper, which runs the chop\. AllFantasy never chops a team here\./)).toBeTruthy()
    // One list: the chop zone leads it, each team once.
    expect([...document.querySelectorAll('.gsb-row strong')].map((e) => e.textContent)).toEqual(['HoldtheDoor', 'Team TheCiege24You', 'Chop till you drop'])
    expect(screen.queryByTestId('imported-guilly-standings')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Guilly details' })).toBeNull()
    // % safe and players left, from the provider-scores outlook.
    expect(screen.getByTestId('gsb-my-left').textContent).toContain('3')
    expect(screen.getByTestId('gsb-my-odds').textContent).toMatch(/\d+%/)
    expect(screen.getByTestId('gsb-left-3').textContent).toContain('1 to play')
    expect(screen.getByTestId('gsb-graveyard').textContent).toContain('Team JukeyDukey86')
  })

  it('says so when the standings cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not an imported Guilly league' }), { status: 404 })))
    render(<ImportedGuillyTab leagueId="L1" />)
    expect((await screen.findByRole('alert')).textContent).toBe('Not an imported Guilly league')
  })
})
