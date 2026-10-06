import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
import RivalryRadar from '@/components/core-app/screens/RivalryRadar'
import { formatSigned1, signOf1 } from '@/lib/core-app/weeklyPercent'
import type { RivalryCard, RivalryRadar as RivalryRadarData } from '@/lib/core-app/weekBoard'

// Production 2026-10-06: a 3–1 series against a departed manager read
// "Team former:sleeper:456193055897153536 · Stop Hatin Satan! · AVERAGE MARGIN -0.0".
const card = (averageMargin: number, projectedMargin: number | null = null) => ({
  leagueId: 'S', leagueName: 'Stop Hatin Satan!', platform: 'sleeper',
  opponent: { rosterId: 'former:sleeper:456193055897153536', name: null, avatarUrl: null },
  series: { wins: 3, losses: 1, ties: 0, meetings: 4 }, averageMargin,
  closest: { season: 2022, week: 3, margin: 0.6, won: true, tied: false },
  thisWeek: projectedMargin == null ? null : { winProbability: 0.5, projectedMargin, status: 'scheduled' },
  sampleTooSmall: false,
}) as unknown as RivalryCard
const radar = (c: RivalryCard) => ({ season: 2026, week: 5, theyOwnYou: [], youOwnThem: [c], even: [], oneToWatch: null,
  totals: { meetings: 4, seasons: 1, platforms: 1 }, firstKickoffAt: null }) as unknown as RivalryRadarData
afterEach(() => cleanup())

describe('Rivalry Radar card figures', () => {
  it('formats a signed margin once, without a negative zero', () => {
    expect([formatSigned1(-0.04), formatSigned1(0.04), formatSigned1(2.25), formatSigned1(-66.2)]).toEqual(['0.0', '0.0', '+2.3', '-66.2'])
    expect([signOf1(-0.04), signOf1(0.06), signOf1(-0.06)]).toEqual(['zero', 'pos', 'neg'])
  })
  it('names a departed manager and prints a near-zero average margin as 0.0, uncoloured', () => {
    const { container } = render(<RivalryRadar data={radar(card(-0.04, -0.03))} weekHref="/core/week" />)
    expect(screen.getByRole('heading', { name: 'Former manager' })).toBeTruthy()
    expect(container.textContent).not.toContain('former:sleeper')
    expect(container.textContent).not.toContain('-0.0')
    const margin = container.querySelector('.af-rr-stats dd[data-sign]')!
    expect(margin.textContent).toBe('0.0')
    expect(margin.getAttribute('data-sign')).toBe('zero')
    expect(container.querySelector('.af-rr-today-gap')!.textContent).toBe('0.0 projected')
  })
  it('keeps real signs on real margins', () => {
    const { container } = render(<RivalryRadar data={radar(card(-48.66, 2.25))} weekHref="/core/week" />)
    const margin = container.querySelector('.af-rr-stats dd[data-sign]')!
    expect([margin.textContent, margin.getAttribute('data-sign')]).toEqual(['-48.7', 'neg'])
    expect(container.querySelector('.af-rr-today-gap')!.textContent).toBe('+2.3 projected')
  })
})
