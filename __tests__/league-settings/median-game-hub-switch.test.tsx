/**
 * The native settings hub's Playoffs tab ("Quick schedule") carries the league median game switch,
 * beside the "League median in playoffs" toggle that depends on it. It saves as `medianGame`, the
 * dependent toggle follows it at once, and a refused save (the server locks it once the season's first
 * week is final) puts the switch back and shows why.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: true }) }))
const hook = vi.hoisted(() => ({ queuePatch: vi.fn(), lastError: null as string | null }))
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: () => ({ queuePatch: hook.queuePatch, saving: false, lastError: hook.lastError, manual: false }),
}))

import { PlayoffsTab } from '@/components/league-settings/tabs/PlayoffsTab'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'
import { clearSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'

beforeEach(() => {
  hook.queuePatch.mockClear()
  hook.lastError = null
  clearSavedLeagueOverrides()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ stages: [], sport: 'NFL', config: null }) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ctx = (league: Record<string, unknown>) =>
  ({ league: { id: 'L', sport: 'NFL', platform: 'manual', teams: [], leagueSize: 12, playoffTeams: 6, playoffStartWeek: 15, settings: {}, ...league } }) as never
const switchInput = () => screen.getByTestId('median-game-toggle').querySelector('input') as HTMLInputElement

describe('settings hub — league median game switch', () => {
  it('shows in the Playoffs tab, reflects the stored value, and saves as medianGame', () => {
    render(<PlayoffsTab ctx={ctx({ medianGame: false })} canEdit hasAfCommissionerSub={false} />)
    expect(screen.getByTestId('median-game-toggle').textContent).toContain('League median game')
    expect(switchInput().checked).toBe(false)
    expect(screen.queryByTestId('median-in-playoffs-toggle')).toBeNull()
    fireEvent.click(switchInput())
    expect(hook.queuePatch).toHaveBeenCalledWith({ medianGame: true })
    // The dependent toggle follows the switch without a reload.
    expect(screen.getByTestId('median-in-playoffs-toggle')).toBeTruthy()
  })

  it('turning it off hides the playoff toggle', () => {
    render(<PlayoffsTab ctx={ctx({ medianGame: true })} canEdit hasAfCommissionerSub={false} />)
    expect(switchInput().checked).toBe(true)
    fireEvent.click(switchInput())
    expect(hook.queuePatch).toHaveBeenCalledWith({ medianGame: false })
    expect(screen.queryByTestId('median-in-playoffs-toggle')).toBeNull()
  })

  it('a refused save puts the switch back and shows the reason', () => {
    const view = render(<PlayoffsTab ctx={ctx({ medianGame: false })} canEdit hasAfCommissionerSub={false} />)
    fireEvent.click(switchInput())
    expect(switchInput().checked).toBe(true)
    hook.lastError = "The league median game can change only until the season's first week is final."
    view.rerender(<PlayoffsTab ctx={ctx({ medianGame: false })} canEdit hasAfCommissionerSub={false} />)
    expect(switchInput().checked).toBe(false)
    expect(screen.getByRole('alert').textContent).toMatch(/first week is final/)
  })

  it('is disabled for a member who cannot edit', () => {
    render(<PlayoffsTab ctx={ctx({ medianGame: true })} canEdit={false} hasAfCommissionerSub={false} />)
    expect(switchInput().disabled).toBe(true)
  })

  it('a category league is not offered it, unless it is already on (so it can be turned off)', () => {
    render(<PlayoffsTab ctx={ctx({ medianGame: false, settings: { scoring_mode: 'h2h_category' } })} canEdit hasAfCommissionerSub={false} />)
    expect(screen.queryByTestId('median-game-toggle')).toBeNull()
    cleanup()
    render(<PlayoffsTab ctx={ctx({ medianGame: true, settings: { scoring_mode: 'h2h_category' } })} canEdit hasAfCommissionerSub={false} />)
    expect(screen.getByTestId('median-game-toggle')).toBeTruthy()
  })

  it('has EN and ES labels, and says when it locks', () => {
    expect(translations.en['lsHub.po.medianGame']).toBe('League median game')
    expect(translations.en['lsHub.po.medianGameHelp']).toMatch(/until the season's first week is final/)
    expect(translationsEsParity['lsHub.po.medianGame']).toBe('Juego contra la mediana de la liga')
    expect(translationsEsParity['lsHub.po.medianGameHelp']).toMatch(/primera semana/)
  })
})
