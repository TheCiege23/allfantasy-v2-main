/**
 * The Devy home's lower panels stay readable in light mode (2026-11-08, Devy audit item 4). The specialty shell is
 * dark in every mode, but app/globals.css clamps `text-white` dark under `html[data-mode="light"] .mode-readable`, so
 * the Tailwind panels below the hero (Draft Center, commissioner tools, the pool line) rendered dark text on a dark
 * panel. The clamp's own opt-out is `.af-draft-dark`; everything under the hero must sit inside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { DevyHome } from '@/components/devy/DevyHome'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u' } }, status: 'authenticated' }) }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => (dict.en as Record<string, string>)[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})

const summary = {
  leagueId: 'l', sport: 'NFL', sportAdapterId: 'nfl_devy',
  config: { devySlotCount: 6, taxiSize: 5, rookieDraftRounds: 4, devyDraftRounds: 3, startupVetRounds: 22, bestBallEnabled: false,
    startupDraftType: 'snake', rookieDraftType: 'linear', devyDraftType: 'snake' },
  draftPhase: 'devy', draftPhaseInfo: { phase: 'devy', status: 'completed', description: 'd' }, sessionId: 's', promotionEligibleCount: 1,
  league: { name: 'L', season: 2026, teamCount: 12, rosterSize: 26 },
  my: { rosterId: 'r', proRosterCount: 24, stash: [], pipeline: [] },
  feed: [],
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('/devy/summary') ? summary : { eligible: [], seasonYear: 2026, config: null, overrides: [] }),
  })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Devy home in light mode', () => {
  it('the opt-out class is still the one the readability clamp honours', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/html\[data-mode="light"\] \.mode-readable \[class\*="text-white"\]:where\(:not\(\.af-draft-dark, \.af-draft-dark \*\)\)/)
  })
  it('every panel under the hero sits inside .af-draft-dark', async () => {
    render(<DevyHome leagueId="l" isCommissioner />)
    const center = await screen.findByRole('heading', { name: 'Draft Center' })
    const promo = await screen.findByText('Offseason promotion')
    for (const el of [center, screen.getByText('Devy commissioner tools'), promo, screen.getByText(/NCAA Football devy pool/)]) {
      expect(el.closest('.af-draft-dark'), el.textContent ?? '').toBeTruthy()
    }
  })
})
