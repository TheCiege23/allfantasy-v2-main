/**
 * The Devy home shows no cards that can never have data (2026-11-07, Devy audit item 2). DevyLeagueHomeCards drew six
 * cards — devy and rookie draft countdowns, promotion window, future class strength, best stashes, upcoming graduates —
 * but DevyHome passed it only the league id and the eligible count, and nothing else in the app calls it. So for every
 * league five of the six read "Date TBD", "No data" or "—", and the sixth always said "Promotion Window: Closed" —
 * contradicting the hero on the same page, which reads the real window from the promotion route ("Open").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { existsSync } from 'node:fs'
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
  draftPhase: 'devy', draftPhaseInfo: null, sessionId: null, promotionEligibleCount: 0,
  league: { name: 'L', season: 2026, teamCount: 12, rosterSize: 26 },
  my: { rosterId: 'r', proRosterCount: 24, stash: [], pipeline: [] },
  feed: [],
}
const promotion = { eligible: [], seasonYear: 2026, config: null, promotionWindow: { timing: 'manager_choice_before_rookie_draft', timingLabel: 'Manager must choose before rookie draft', deadlineIso: null } }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => (String(url).includes('/devy/summary') ? summary : { ...promotion, overrides: [] }) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Devy home cards', () => {
  it('draws none of the six data-less cards', async () => {
    render(<DevyHome leagueId="l" />)
    await screen.findByText(/devy pool/)
    for (const title of ['Devy Draft Countdown', 'Rookie Draft Countdown', 'Promotion Window', 'Future Class Strength', 'Best Devy Stashes', 'Upcoming Graduates']) {
      expect(screen.queryByText(title), title).toBeNull()
    }
    expect(screen.queryByText('Date TBD')).toBeNull()
    expect(screen.queryByText('Closed')).toBeNull()
  })
  it('the component is gone, not just unmounted', () => {
    expect(existsSync('components/devy/DevyLeagueHomeCards.tsx')).toBe(false)
  })
})
