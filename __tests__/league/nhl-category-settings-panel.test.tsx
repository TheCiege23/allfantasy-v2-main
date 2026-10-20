/**
 * An NHL category league's scoring settings show its categories, not the point-weight editor whose
 * weights it never scores with — the same switch NBA's panel makes for its category leagues.
 */
import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/league/l1', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/hooks/useAfSubGate', () => ({ useAfSubGate: () => ({ handleApiResponse: async () => true }) }))
const stub = vi.hoisted(() => (name: string, testId?: string) => ({ [name]: () => (testId ? <div data-testid={testId} /> : null) }))
vi.mock('@/components/league-settings/PlayoffSettingsEditor', () => stub('PlayoffSettingsEditor'))
vi.mock('@/components/league-settings/RosterSettingsEditor', () => stub('RosterSettingsEditor'))
vi.mock('@/components/league-settings/NflScoringSettingsPanel', () => stub('NflScoringSettingsPanel'))
vi.mock('@/components/league-settings/NbaScoringSettingsPanel', () => stub('NbaScoringSettingsPanel'))
vi.mock('@/components/league-settings/NcaabScoringSettingsPanel', () => stub('NcaabScoringSettingsPanel'))
vi.mock('@/components/league-settings/MlbScoringSettingsPanel', () => stub('MlbScoringSettingsPanel'))
vi.mock('@/components/league-settings/NhlScoringSettingsPanel', () => stub('NhlScoringSettingsPanel', 'nhl-points-panel'))
vi.mock('@/components/league-settings/NcaafScoringSettingsPanel', () => stub('NcaafScoringSettingsPanel'))
vi.mock('@/components/league-settings/SoccerScoringSettingsPanel', () => stub('SoccerScoringSettingsPanel'))
vi.mock('@/components/app/settings/ScoringSettingsPanel', () => ({ default: () => <div data-testid="category-panel" /> }))
vi.mock('@/components/league-settings/DraftSettingsCommissionerPanel', () => stub('DraftSettingsCommissionerPanel'))
vi.mock('@/components/league-settings/DivisionSettingsCommissionerPanel', () => stub('DivisionSettingsCommissionerPanel'))
vi.mock('@/components/league-settings/MemberSettingsCommissionerPanel', () => stub('MemberSettingsCommissionerPanel'))
vi.mock('@/app/idp/components/settings/IDPRosterPanel', () => stub('IDPRosterPanel'))
vi.mock('@/app/idp/components/settings/IDPScoringPanel', () => stub('IDPScoringPanel'))
vi.mock('@/app/idp/components/settings/IDPDisplayPanel', () => stub('IDPDisplayPanel'))
vi.mock('@/app/idp/components/settings/IDPAIPanel', () => stub('IDPAIPanel'))
vi.mock('@/app/league/[leagueId]/components/DeleteLeagueFromAfPanel', () => stub('DeleteLeagueFromAfPanel'))
vi.mock('@/components/monetization/PlanRefusalNotice', () => stub('PlanRefusalNotice'))

import { SettingsSubPanelBody } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'

function ctx(settings: Record<string, unknown>) {
  return {
    league: { id: 'l1', platform: 'allfantasy', userId: 'u1', sport: 'NHL', settings, invites: [], teams: [] },
    displayLeague: { id: 'l1', name: 'Puck League', teamCount: 10, sport: 'NHL', season: 2026, currentWeek: 1, draftDate: null },
    userId: 'u1', userTeam: null, sleeperLeagueId: null, platformLeagueId: null,
    isCommissioner: true, isHeadCommissioner: true, sleeperMemberMap: {}, onGoToDraftTab: () => {},
  } as never
}

afterEach(() => vi.unstubAllGlobals())

describe('NHL scoring settings panel choice', () => {
  it('a category league shows its categories, not point weights', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const r = render(<SettingsSubPanelBody panelId="scoring" ctx={ctx({ scoring_mode: 'h2h_category', category_preset_id: 'nhl_10cat', category_record_mode: 'most' })} />)
    expect(r.queryByTestId('category-panel')).toBeTruthy()
    expect(r.queryByTestId('nhl-points-panel')).toBeNull()
  })

  it('a points league keeps the point-weight editor', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const r = render(<SettingsSubPanelBody panelId="scoring" ctx={ctx({ scoring_mode: 'points' })} />)
    expect(r.queryByTestId('nhl-points-panel')).toBeTruthy()
    expect(r.queryByTestId('category-panel')).toBeNull()
  })
})
