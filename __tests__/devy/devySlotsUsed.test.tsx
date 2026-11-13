/**
 * The Devy Draft Center shows the stash's real slot count (2026-11-07, Devy audit item 1). DevyHome passed
 * `devySlotsUsed={0}` — a literal — so every Devy league read "0 / N used" in the Draft Center while the stash card on
 * the same page read 5/6.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DevyHome } from '@/components/devy/DevyHome'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u' } }, status: 'authenticated' }) }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => (dict.en as Record<string, string>)[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})

const stash = (n: number) => Array.from({ length: n }, (_, i) => ({
  rightsId: `r${i}`, devyPlayerId: `p${i}`, name: `Prospect ${i}`, position: 'WR', school: 'State', classLabel: 'So',
  draftEligibleYear: 2027, state: 'NCAA_DEVY_ACTIVE', declared: false, production: 80, promotionEligible: false, promotedProPlayerId: null,
}))
const summary = (n: number) => ({
  leagueId: 'l', sport: 'NFL', sportAdapterId: 'nfl_devy',
  config: { devySlotCount: 6, taxiSize: 5, rookieDraftRounds: 4, devyDraftRounds: 3, startupVetRounds: 22, bestBallEnabled: false,
    startupDraftType: 'snake', rookieDraftType: 'linear', devyDraftType: 'snake' },
  draftPhase: 'devy', draftPhaseInfo: null, sessionId: null, promotionEligibleCount: 0,
  league: { name: 'L', season: 2026, teamCount: 12, rosterSize: 26 },
  my: { rosterId: 'r', proRosterCount: 24, stash: stash(n), pipeline: [] },
  feed: [],
})

let current = summary(5)
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('/devy/summary') ? current : { eligible: [], seasonYear: 2026, config: null, overrides: [] }),
  })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Devy Draft Center slot count', () => {
  it('matches the stash, not a constant 0', async () => {
    current = summary(5)
    render(<DevyHome leagueId="l" />)
    expect(await screen.findByText('5 / 6 used')).toBeTruthy()
    expect(screen.queryByText('0 / 6 used')).toBeNull()
  })
  it('reads 0 only when the stash really is empty', async () => {
    current = summary(0)
    render(<DevyHome leagueId="l" />)
    expect(await screen.findByText('0 / 6 used')).toBeTruthy()
  })
})
