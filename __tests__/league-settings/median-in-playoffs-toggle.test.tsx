/**
 * "League median in playoffs" is offered in commissioner settings only when the league plays a median
 * game, starts OFF unless the league stored it on, and saves as `medianGameInPlayoffs`.
 *
 * Covered: the native settings hub (Playoffs tab), the commissioner settings modal (League tab) and the
 * shared League Settings tab.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

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
import { LeagueSettingsTab } from '@/components/league/LeagueSettingsTab'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  queuePatch.mockClear()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ stages: [], sport: 'NFL', config: null }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const hubCtx = (league: Record<string, unknown>) =>
  ({ league: { id: 'L', sport: 'NFL', platform: 'manual', teams: [], leagueSize: 12, playoffTeams: 6, playoffStartWeek: 15, settings: {}, ...league } }) as never

describe('settings hub — Playoffs tab', () => {
  it('native redraft with the median game on: shows the toggle, OFF by default', () => {
    render(<PlayoffsTab ctx={hubCtx({ medianGame: true })} canEdit hasAfCommissionerSub={false} />)
    const row = screen.getByTestId('median-in-playoffs-toggle')
    expect(row.textContent).toContain('League median in playoffs')
    expect(row.textContent).toContain('win-or-go-home')
    expect((row.querySelector('input') as HTMLInputElement).checked).toBe(false)
  })

  it('reads a stored ON, and saves the change as medianGameInPlayoffs', () => {
    render(<PlayoffsTab ctx={hubCtx({ medianGame: true, settings: { median_game_in_playoffs: true } })} canEdit hasAfCommissionerSub={false} />)
    const input = screen.getByTestId('median-in-playoffs-toggle').querySelector('input') as HTMLInputElement
    expect(input.checked).toBe(true)
    fireEvent.click(input)
    expect(queuePatch).toHaveBeenCalledWith({ medianGameInPlayoffs: false })
  })

  it('is hidden when the league plays no median game', () => {
    render(<PlayoffsTab ctx={hubCtx({ medianGame: false, settings: { median_game_in_playoffs: true } })} canEdit hasAfCommissionerSub={false} />)
    expect(screen.queryByTestId('median-in-playoffs-toggle')).toBeNull()
  })

  it('a member who cannot edit sees it disabled', () => {
    render(<PlayoffsTab ctx={hubCtx({ medianGame: true })} canEdit={false} hasAfCommissionerSub={false} />)
    expect((screen.getByTestId('median-in-playoffs-toggle').querySelector('input') as HTMLInputElement).disabled).toBe(true)
  })

  it('has EN and ES labels', () => {
    expect(translations.en['lsHub.po.medianPlayoffs']).toBe('League median in playoffs')
    expect(translations.en['lsHub.po.medianPlayoffsHelp']).toMatch(/^Off: playoff weeks are win-or-go-home only\./)
    expect(translationsEsParity['lsHub.po.medianPlayoffs']).toMatch(/mediana/i)
    expect(translationsEsParity['lsHub.po.medianPlayoffsHelp']).toMatch(/playoffs/)
  })
})

describe('commissioner settings modal — League tab', () => {
  // Stable, as the modal passes it: a fresh default object each render re-seeds the panel's state.
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
  const toggle = () => screen.queryByRole('switch', { name: /League median in playoffs/i })

  it('shows the toggle under the median game, OFF by default, and saves it', () => {
    const save = panel({ medianGame: true })
    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle()!)
    expect(save).toHaveBeenCalledWith({ medianGameInPlayoffs: true })
  })

  it('hides it while the median game is off and shows it once it is turned on', () => {
    const save = panel({ medianGame: false, medianGameInPlayoffs: true })
    expect(toggle()).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: /Extra game vs league median/i }))
    expect(save).toHaveBeenCalledWith({ medianGame: true })
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
  })
})

describe('League Settings tab', () => {
  const league = (extra: Record<string, unknown>) => ({
    name: 'L', sport: 'NFL', season: 2026, leagueSize: 12, scoring: 'PPR', rosterSize: 16, isDynasty: false,
    leagueType: 'keeper', leagueVariant: null, waiverType: 'faab', waiverBudget: 100, tradeReviewHours: 24,
    tradeDeadlineWeek: 10, playoffTeams: 6, playoffStartWeek: 15, timezone: 'UTC', ...extra,
  })

  it('keeper league with the median on: offers the toggle and PATCHes medianGameInPlayoffs', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => league({ medianGame: true, medianGameInPlayoffs: false }) })
    render(<LeagueSettingsTab leagueId="L" canEdit />)
    const sw = await screen.findByRole('switch', { name: /League median in playoffs/i })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }]
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ leagueId: 'L', medianGameInPlayoffs: true })
  })

  it('no median game: no toggle', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => league({ medianGame: false }) })
    render(<LeagueSettingsTab leagueId="L" canEdit />)
    await screen.findByText('Median Game')
    expect(screen.queryByText('League median in playoffs')).toBeNull()
  })
})
