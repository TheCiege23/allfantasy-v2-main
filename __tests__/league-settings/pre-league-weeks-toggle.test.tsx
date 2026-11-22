/**
 * "Count weeks before the draft" (lib/redraft/preLeagueWeeksRules.ts) is offered only on a league that
 * has pre-league weeks loaded, starts OFF unless stored on, and saves as `preLeagueWeeksCount`.
 * Covered: the settings hub (Playoffs tab) and the commissioner settings modal (League tab).
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: true }) }))
vi.mock('@/hooks/useSubscriptionGate', () => ({ useSubscriptionGateOptional: () => null }))
const queuePatch = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: () => ({ queuePatch, saving: false }),
}))

import { PlayoffsTab } from '@/components/league-settings/tabs/PlayoffsTab'
import { LeagueSettingsPanel } from '@/app/league/[leagueId]/components/settings/LeagueSettingsPanel'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'

beforeEach(() => {
  queuePatch.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ stages: [], sport: 'NFL', config: null }) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const hubCtx = (settings: Record<string, unknown>) =>
  ({ league: { id: 'L', sport: 'NFL', platform: 'manual', teams: [], leagueSize: 4, playoffTeams: 0, playoffStartWeek: 19, medianGame: false, settings } }) as never

describe('settings hub — Playoffs tab', () => {
  it('a league with 10 pre-league weeks: shows the toggle naming them, OFF by default, and saves it', () => {
    render(<PlayoffsTab ctx={hubCtx({ pre_league_weeks_loaded: 10 })} canEdit hasAfCommissionerSub={false} />)
    const row = screen.getByTestId('pre-league-weeks-toggle')
    expect(row.textContent).toContain('Count weeks before the draft')
    expect(row.textContent).toContain('Weeks 1–10 were played before this league drafted')
    const input = row.querySelector('input') as HTMLInputElement
    expect(input.checked).toBe(false)
    fireEvent.click(input)
    expect(queuePatch).toHaveBeenCalledWith({ preLeagueWeeksCount: true })
  })

  it('reads a stored ON', () => {
    render(<PlayoffsTab ctx={hubCtx({ pre_league_weeks_loaded: 3, pre_league_weeks_count: true })} canEdit hasAfCommissionerSub={false} />)
    expect((screen.getByTestId('pre-league-weeks-toggle').querySelector('input') as HTMLInputElement).checked).toBe(true)
  })

  it('[control] a league that started on week 1 has no toggle', () => {
    render(<PlayoffsTab ctx={hubCtx({})} canEdit hasAfCommissionerSub={false} />)
    expect(screen.queryByTestId('pre-league-weeks-toggle')).toBeNull()
  })

  it('has EN and ES copy', () => {
    expect(translations.en['lsHub.po.preLeague']).toBe('Count weeks before the draft')
    expect(translationsEsParity['lsHub.po.preLeague']).toMatch(/draft/)
    expect(translationsEsParity['lsHub.po.preLeagueHelp']).toContain('{{weeks}}')
  })
})

describe('commissioner settings modal — League tab', () => {
  const SNAPSHOT = {}
  const panel = (data: Record<string, unknown>, save = vi.fn(async () => undefined)) => {
    render(
      <LeagueSettingsPanel
        leagueId="L"
        initialData={{ leagueType: 'redraft', ...data } as never}
        settingsSnapshot={SNAPSHOT}
        hasAfCommissionerSub
        canEdit
        save={save}
        debouncedSave={vi.fn()}
      />,
    )
    return save
  }
  const toggle = () => screen.queryByRole('switch', { name: /Count weeks before the draft/i })

  it('shows it for a late-start league, OFF by default, and saves it', () => {
    const save = panel({ preLeagueWeekCount: 10 })
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle()!)
    expect(save).toHaveBeenCalledWith({ preLeagueWeeksCount: true })
  })

  it('[control] hidden when there are no pre-league weeks', () => {
    panel({ preLeagueWeekCount: 0, preLeagueWeeksCount: true })
    expect(toggle()).toBeNull()
  })
})
