// @vitest-environment jsdom
/**
 * Dashboard visual bug-fix pass — real rendered-DOM verification for MyLeagueCard's three fixes:
 * (1a) name truncation gets a title attribute and isn't clipped to 3 characters by a flex
 * min-width bug, (1b) a null rank never renders a bare "Rank #", and (1c) the opponent/result
 * cells distinguish preseason from a genuine in-season data gap instead of showing the same dash
 * for both. Uses the REAL translations dict + REAL tInterpolate so assertions check the actual
 * copy a user sees, not translation keys.
 */
import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'
import { tInterpolate as realTInterpolate } from '@/lib/i18n/tInterpolate'

const realT = (key: string) => translations.en[key] ?? key

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({
    t: realT,
    tInterpolate: (key: string, vars?: Record<string, string | number | undefined>) => realTInterpolate(realT, key, vars),
  }),
}))

vi.mock('@/hooks/useActivityFeed', () => ({
  useActivityFeed: () => ({ items: [], loading: false, error: null }),
}))

vi.mock('@/app/dashboard/components/warroom/useLeagueHealth', () => ({
  useLeagueHealth: () => null,
}))

import { MyLeagueCard } from '@/app/dashboard/components/warroom/MyLeagueCard'
import type { UserLeague } from '@/app/dashboard/types'

function baseLeague(overrides: Partial<UserLeague> = {}): UserLeague {
  return {
    id: 'league-1',
    name: 'The Loud Zone Fantasy Dynasty League',
    platform: 'sleeper',
    sport: 'NFL',
    format: 'redraft',
    teamCount: 12,
    status: 'pre_draft',
    lifecycleState: 'pre_draft',
    currentWeek: null,
    ...overrides,
  }
}

const fetchMock = vi.fn()

function mockFetchJson(matcher: (url: string) => unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    const body = matcher(String(url))
    return { ok: body !== undefined, json: async () => body ?? null }
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('MyLeagueCard — name truncation (1a)', () => {
  it('renders the full league name with a title attribute for a tooltip, not clipped to a few characters', async () => {
    mockFetchJson(() => undefined)
    const league = baseLeague({ name: 'The Loud Zone Fantasy Dynasty League' })
    render(<MyLeagueCard league={league} userId="user-1" />)

    const link = screen.getByRole('link', { name: 'The Loud Zone Fantasy Dynasty League' })
    expect(link.textContent).toBe('The Loud Zone Fantasy Dynasty League')
    expect(link.getAttribute('title')).toBe('The Loud Zone Fantasy Dynasty League')
    expect(link.className).toContain('truncate')
    expect(link.className).toContain('min-w-0')
  })
})

describe('MyLeagueCard — rank (1b)', () => {
  it('never renders a bare "Rank #" when currentRank is null — shows the pending message instead', async () => {
    mockFetchJson((url) => {
      if (url.includes('/api/league/detail')) {
        return { teams: [{ externalId: 't1', claimedByUserId: 'user-1', wins: 3, losses: 2, ties: 0, currentRank: null, pointsFor: 400 }] }
      }
      return undefined
    })
    render(<MyLeagueCard league={baseLeague()} userId="user-1" />)

    await waitFor(() => expect(screen.getByText(/Ranking available after Week 1/)).toBeTruthy())
    expect(screen.queryByText(/Rank #(?!.)/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/Rank #(\s|$)/)
  })

  it('renders the real rank number once the API resolves a real currentRank', async () => {
    mockFetchJson((url) => {
      if (url.includes('/api/league/detail')) {
        return { teams: [{ externalId: 't1', claimedByUserId: 'user-1', wins: 6, losses: 1, ties: 0, currentRank: 2, pointsFor: 800 }] }
      }
      return undefined
    })
    render(<MyLeagueCard league={baseLeague()} userId="user-1" />)

    await waitFor(() => expect(screen.getByText(/Rank #2/)).toBeTruthy())
  })
})

describe('MyLeagueCard — opponent/result empty vs broken (1c)', () => {
  it('shows a preseason notice, not a bare dash, when the league has not started', async () => {
    mockFetchJson((url) => {
      if (url.includes('/api/league/detail')) {
        return { teams: [{ externalId: 't1', claimedByUserId: 'user-1', wins: 0, losses: 0, ties: 0, currentRank: null, pointsFor: 0 }] }
      }
      return undefined
    })
    render(<MyLeagueCard league={baseLeague({ status: 'pre_draft', lifecycleState: 'pre_draft' })} userId="user-1" />)

    await waitFor(() => expect(screen.getAllByText(/Preseason — matchups not set/).length).toBe(2))
  })

  it('shows a distinct "not available" message for an in-season league whose matchup fetch never resolves data — not the same dash as preseason', async () => {
    mockFetchJson((url) => {
      if (url.includes('/api/league/detail')) {
        return { teams: [{ externalId: 't1', claimedByUserId: 'user-1', wins: 4, losses: 3, ties: 0, currentRank: 5, pointsFor: 900 }] }
      }
      if (url.includes('/matchups')) return { matchups: [] }
      return undefined
    })
    render(
      <MyLeagueCard
        league={baseLeague({ status: 'in_season', lifecycleState: 'in_season', currentWeek: 5 })}
        userId="user-1"
      />,
    )

    await waitFor(() => expect(screen.getAllByText(/Not available right now/).length).toBe(2))
    expect(screen.queryByText(/Preseason/)).toBeNull()
  })

  it('distinguishes "no result yet, week 1" from a genuine gap once an opponent is resolved but no game has been played', async () => {
    mockFetchJson((url) => {
      if (url.includes('/api/league/detail')) {
        return { teams: [{ externalId: 't1', claimedByUserId: 'user-1', wins: 0, losses: 0, ties: 0, currentRank: null, pointsFor: 0 }] }
      }
      if (url.includes('/matchups')) {
        return { matchups: [{ teamAId: 't1', teamBId: 't2', teamAName: 'My Team', teamBName: 'Rival Squad', scoreA: 0, scoreB: 0 }] }
      }
      return undefined
    })
    render(
      <MyLeagueCard
        league={baseLeague({ status: 'in_season', lifecycleState: 'in_season', currentWeek: 1 })}
        userId="user-1"
      />,
    )

    await waitFor(() => expect(screen.getByText('Rival Squad')).toBeTruthy())
    expect(screen.getByText(/No result yet — Week 1/)).toBeTruthy()
  })
})
