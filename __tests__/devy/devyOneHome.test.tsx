/**
 * The Devy home is one page, not two (2026-11-07, Devy audit item 3). Under the specialty home sat an older layout:
 * a separate "Draft" card (phase, status, "Go to Draft") above a Draft Center with its own "Go to Draft", an
 * "Offseason promotion" panel that, most of the year, only said "No promotion-eligible devy players right now", and a
 * trailing "League settings" link the sidebar already carries. Now the draft phase and status live in the Draft
 * Center (which opens on that draft's tab), the promotion panel appears only when someone can be promoted, and the
 * settings link is gone. The commissioner's devy tools stay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { DevyHome } from '@/components/devy/DevyHome'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u' } }, status: 'authenticated' }) }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => (dict.en as Record<string, string>)[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})

const summary = (eligible: number) => ({
  leagueId: 'l', sport: 'NFL', sportAdapterId: 'nfl_devy',
  config: { devySlotCount: 6, taxiSize: 5, rookieDraftRounds: 4, devyDraftRounds: 3, startupVetRounds: 22, bestBallEnabled: false,
    startupDraftType: 'snake', rookieDraftType: 'linear', devyDraftType: 'snake' },
  draftPhase: 'devy',
  draftPhaseInfo: { phase: 'devy', status: 'completed', description: 'Annual devy draft for college prospects. Picks go to your devy stash.' },
  sessionId: 's', promotionEligibleCount: eligible,
  league: { name: 'L', season: 2026, teamCount: 12, rosterSize: 26 },
  my: { rosterId: 'r', proRosterCount: 24, stash: [], pipeline: [] },
  feed: [],
})
let current = summary(0)
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('/devy/summary') ? current : { eligible: [], seasonYear: 2026, config: null, overrides: [] }),
  })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Devy home, lower half', () => {
  it('one draft section: phase and status in the Draft Center, one "Go to Draft"', async () => {
    current = summary(0)
    render(<DevyHome leagueId="l" />)
    const center = (await screen.findByRole('heading', { name: 'Draft Center' })).closest('div[data-devy-draft-center]') as HTMLElement
    expect(center, 'Draft Center root carries data-devy-draft-center').toBeTruthy()
    expect(within(center).getByText(/Now: Devy draft · completed/)).toBeTruthy()
    expect(within(center).getByRole('button', { name: 'Devy Draft', pressed: true })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Go to Draft' })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Draft', exact: true })).toBeNull()
  })
  it('no "Offseason promotion" panel when nobody can be promoted, and no trailing settings link', async () => {
    current = summary(0)
    render(<DevyHome leagueId="l" isCommissioner />)
    await screen.findByRole('heading', { name: 'Draft Center' })
    expect(screen.queryByText('Offseason promotion')).toBeNull()
    expect(screen.queryByRole('link', { name: 'League settings' })).toBeNull()
    expect(screen.getByText('Devy commissioner tools')).toBeTruthy()
  })
  it('the promotion panel appears when someone can be promoted', async () => {
    current = summary(2)
    render(<DevyHome leagueId="l" />)
    expect(await screen.findByText('Offseason promotion')).toBeTruthy()
  })
})
