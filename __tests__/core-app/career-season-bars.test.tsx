// @vitest-environment jsdom
/**
 * Career → Season by season (board: Career, 2026-11). Bars are a straight read of `CareerSeasonRow`:
 * ordered by year, height = win rate, a star only where a title was won, and a year with no games
 * drawing no bar at all (never a 0% one, which would read as a winless season).
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { SeasonBars } from '@/components/core-app/career/SeasonBars'
import type { CareerSeasonRow } from '@/lib/core-app/careerModel'

const row = (season: number, wins: number, losses: number, championships = 0): CareerSeasonRow => {
  const games = wins + losses
  return {
    season,
    wins,
    losses,
    ties: 0,
    games,
    winRate: games ? wins / games : null,
    leagueCount: 2,
    championships,
    playoffAppearances: championships,
    playoffKnownCount: 2,
    pointsFor: null,
    pointsGames: 0,
    pointsPerGame: null,
    titlesToDate: 0,
    best: null,
  }
}

afterEach(() => {
  cleanup()
  h.language = 'en'
})

const cols = () => Array.from(document.querySelectorAll('.af-crs-col')) as HTMLElement[]

describe('SeasonBars', () => {
  it('draws one bar per season in year order, sized by win rate, with stars only on title years', () => {
    render(<SeasonBars seasons={[row(2024, 9, 5, 1), row(2022, 7, 7), row(2023, 0, 0), row(2025, 4, 10)]} />)
    expect(cols().map((c) => c.dataset.season)).toEqual(['2022', '2023', '2024', '2025'])
    const heights = cols().map((c) => (c.querySelector('.af-crs-bar') as HTMLElement | null)?.style.height ?? null)
    expect(heights).toEqual(['50%', null, '64%', '29%'])
    expect(cols().map((c) => c.querySelector('.af-crs-star')?.textContent ?? null)).toEqual([null, null, '★ 1', null])
    expect(cols()[1].dataset.empty).toBe('true')
    expect(cols()[1].textContent).toContain('no games')
    expect(cols()[2].getAttribute('aria-label')).toBe('2024: 9–5, 64% win rate, 1 title')
    expect(screen.getByText('Best: 2024 at 64%')).toBeInTheDocument()
  })

  it('renders nothing without seasons', () => {
    const { container } = render(<SeasonBars seasons={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('reads Spanish when the reader does', () => {
    h.language = 'es'
    render(<SeasonBars seasons={[row(2024, 9, 5, 2)]} />)
    expect(screen.getByRole('heading', { name: 'Temporada a temporada' })).toBeInTheDocument()
    expect(cols()[0].getAttribute('aria-label')).toBe('2024: 9–5, 64% de victorias, 2 títulos')
  })
})
