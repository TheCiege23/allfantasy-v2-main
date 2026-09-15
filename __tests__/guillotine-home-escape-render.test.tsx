import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/decide/shareCard', () => ({ shareCardImage: vi.fn(async () => 'downloaded') }))
vi.mock('@/components/guillotine/GuillotineAIPanel', () => ({ GuillotineAIPanel: () => null }))
vi.mock('@/components/guillotine/GuillotineChopAnimation', () => ({ GuillotineChopAnimation: () => null }))

import { shareCardImage } from '@/components/decide/shareCard'
import { GuillotineHome } from '@/components/guillotine/GuillotineHome'

/*
 * Your guillotine escape on the league home (shareable moments, 2026-09-14): shown only when the
 * summary carries one, worded from the chop that happened, with a share button for the card image.
 */

const summary = (over: Record<string, unknown> = {}) => ({
  leagueId: 'league-1',
  weekOrPeriod: 5,
  choppedThisWeek: [],
  survivalStandings: [],
  dangerTiers: [],
  recentChopEvents: [{ weekOrPeriod: 4, choppedRosterIds: ['r4'] }],
  assets: { leagueImage: '/guillotine/Guillotine.png', introVideo: '/guillotine/Guillotine.mp4' },
  config: null,
  ...over,
})

const mount = (body: unknown) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }))
  return render(<GuillotineHome leagueId="league-1" sport="NFL" leagueName="Blade League" />)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(shareCardImage).mockClear()
})

describe('GuillotineHome — your escape', () => {
  it('🛑 states the escape from the chop that happened, and shares its card image', async () => {
    const { container } = mount(
      summary({ myEscapes: [{ weekOrPeriod: 4, myPoints: 93.5, chopLine: 90.3, margin: 3.2, choppedCount: 1 }, { weekOrPeriod: 2, myPoints: 80, chopLine: 79, margin: 1, choppedCount: 1 }] }),
    )
    await waitFor(() => expect(screen.getByTestId('guillotine-my-escape')).toBeTruthy())
    expect(container.querySelector('[data-testid="guillotine-my-escape"] p')?.textContent).toBe(
      'You survived week 4’s chop by 3.2 pts · 93.5 vs 90.3',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Share escape card' }))
    expect(shareCardImage).toHaveBeenCalledWith(
      '/api/share/rivalry-card?kind=escape&leagueId=league-1&week=4',
      'guillotine-escape-week-4.png',
      "Survived week 4's chop",
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Card saved ✓' })).toBeTruthy())
  })

  it('a zero margin is the tiebreaker', async () => {
    const { container } = mount(summary({ myEscapes: [{ weekOrPeriod: 4, myPoints: 90, chopLine: 90, margin: 0, choppedCount: 1 }] }))
    await waitFor(() => expect(screen.getByTestId('guillotine-my-escape')).toBeTruthy())
    expect(container.querySelector('[data-testid="guillotine-my-escape"] p')?.textContent).toBe(
      'You survived week 4’s chop on the tiebreaker · 90.0 vs 90.0',
    )
  })

  it('no escape (or an older summary without the field) renders nothing', async () => {
    mount(summary({ myEscapes: [] }))
    await waitFor(() => expect(screen.getByText('Survival Board')).toBeTruthy())
    expect(screen.queryByTestId('guillotine-my-escape')).toBeNull()
    vi.unstubAllGlobals()
    mount(summary())
    await waitFor(() => expect(screen.getAllByText('Survival Board').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('guillotine-my-escape')).toBeNull()
  })
})
