/**
 * The player-comparison pages are one tool (2026-11-12): the Player Comparison Lab.
 * /player-compare 308s into it with its query, and the Lab carries that page's league start/sit read.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const redirectTo = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})
vi.mock('next/navigation', () => ({ permanentRedirect: (url: string) => redirectTo(url) }))

import PlayerComparePage from '@/app/player-compare/page'
import { LeagueStartVsCard } from '@/components/player-comparison-lab/LeagueStartVsCard'

const go = (sp: Record<string, string | string[] | undefined>) =>
  PlayerComparePage({ searchParams: Promise.resolve(sp) }).catch((e: Error) => e.message)

afterEach(() => {
  redirectTo.mockClear()
  vi.unstubAllGlobals()
})

describe('/player-compare redirects into the Lab', () => {
  it('carries the players, sport and league', async () => {
    expect(await go({ playerA: 'Josh Allen', playerB: 'Jalen Hurts', sport: 'NFL', leagueId: 'L 1', junk: 'x' })).toBe(
      'REDIRECT:/player-comparison-lab?playerA=Josh+Allen&playerB=Jalen+Hurts&sport=NFL&leagueId=L+1',
    )
  })

  it('bare, it opens the bare Lab', async () => {
    expect(await go({})).toBe('REDIRECT:/player-comparison-lab')
  })
})

describe('LeagueStartVsCard — the league read, never an AI spend', () => {
  const read = {
    short_verdict: 'Start Josh Allen',
    confidence_pct: 71,
    coach_lens: {
      median_play: { side: 'playerA', player_name: 'Josh Allen' },
      safer_play: { side: 'playerA', player_name: 'Josh Allen' },
      higher_ceiling_play: { side: 'playerB', player_name: 'Jalen Hurts' },
      confidence_pct: 68,
      concise_explanation: 'Allen has the safer floor this week.',
      weather_note: null,
    },
    risk_flags: ['Hurts is questionable'],
    news_flags: [],
    missing_data: [],
    actions: {
      set_lineup: { href: '/league/L1?view=lineup', label: 'Set lineup' },
      ask_chimmy: { href: '/chimmy/chat?prompt=x', label: 'Ask Chimmy' },
      compare_again: { href: '/player-comparison-lab', label: 'Compare again' },
    },
  }

  it('asks the league route with the AI explanation off, and shows its read', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => read })
    vi.stubGlobal('fetch', fetchMock)
    render(<LeagueStartVsCard leagueId="L1" playerA="Josh Allen" playerB="Jalen Hurts" sport="NFL" />)
    await waitFor(() => expect(screen.getByTestId('league-start-vs-verdict').textContent).toBe('Start Josh Allen'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/leagues/L1/player-comparison/start-vs')
    expect(JSON.parse(init.body)).toMatchObject({ playerA: 'Josh Allen', playerB: 'Jalen Hurts', includeAIExplanation: false })
    expect(screen.getByText('68% confidence')).toBeTruthy()
    expect(screen.getByText('Hurts is questionable')).toBeTruthy()
    expect(screen.getByText('Set lineup').getAttribute('href')).toBe('/league/L1?view=lineup')
  })

  it('signed out, it says so instead of a read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    render(<LeagueStartVsCard leagueId="L1" playerA="A" playerB="B" sport="NFL" />)
    await waitFor(() => expect(screen.getByText(/Sign in to see how these two fit your league/)).toBeTruthy())
    expect(screen.queryByTestId('league-start-vs-verdict')).toBeNull()
  })
})
