/**
 * The Devy home's rail (pipeline, rules, latest) fills its row on desktop (2026-11-08, Devy audit item 5). The shared
 * specialty rail is a fixed 380px column; between ~1000px and ~1500px of content it wraps under the main column and
 * stayed 380 wide, leaving about half the row empty at 1440. Devy's rail now carries `.railWide`, which grows to fill
 * a wrapped row and sets the cards in columns, and keeps the shared 380px column when it fits beside the main column.
 * Other formats are untouched: SpecialtyGrid adds a rail class only when asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { DevyHome } from '@/components/devy/DevyHome'
import { SpecialtyGrid } from '@/components/league/specialty/SpecialtyShell'

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
  draftPhase: 'devy', draftPhaseInfo: null, sessionId: null, promotionEligibleCount: 0,
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

describe('Devy rail on desktop', () => {
  it('the Devy rail carries railWide', async () => {
    render(<DevyHome leagueId="l" />)
    const rail = (await screen.findByText('Devy rules')).closest('aside') as HTMLElement
    expect(rail).toBeTruthy()
    expect(rail.className).toMatch(/railWide/)
  })
  it('railWide grows and sets columns when wrapped, and keeps the 380px column beside the main one', () => {
    const css = readFileSync('components/league/specialty/devy/devy-specialty.module.css', 'utf8').replace(/\r\n/g, '\n')
    expect(css).toMatch(/\.railWide\.railWide \{ flex: 1 1 380px; display: grid; grid-template-columns: repeat\(auto-fit, minmax\(220px, 1fr\)\)/)
    expect(css).toMatch(/@container \(min-width: 1048px\) \{\n {2}\.railWide\.railWide \{ flex: 0 1 380px; display: flex; flex-direction: column; align-items: stretch; \}\n\}/)
  })
  it('other formats keep the shared rail only', () => {
    const { container } = render(<SpecialtyGrid main={<p>m</p>} rail={<p>r</p>} />)
    expect(container.querySelector('aside')!.className).not.toMatch(/railWide/)
  })
})
