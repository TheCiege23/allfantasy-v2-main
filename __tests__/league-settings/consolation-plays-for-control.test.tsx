/**
 * The native settings hub's Playoffs tab offers "Consolation plays for" and saves it as
 * `consolationPlaysFor` through the league settings PATCH (execute-league-settings-patch stores it in
 * `settings.playoff_structure` with the draft-order flag — lib/playoff-runtime/consolationPlaysFor.ts).
 *
 * A league created before the setting moved the draft order shows "Not set" rather than the sport
 * default it stores: saving a choice is what opts it in, so it must not look already chosen.
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
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'

beforeEach(() => {
  queuePatch.mockClear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stages: [], sport: 'NFL', config: null }) }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const hubCtx = (league: Record<string, unknown>) =>
  ({ league: { id: 'L', sport: 'NFL', platform: 'manual', teams: [], leagueSize: 12, playoffTeams: 6, playoffStartWeek: 15, settings: {}, ...league } }) as never

const select = () => screen.getByTestId('consolation-plays-for').querySelector('select') as HTMLSelectElement
const options = () => Array.from(select().options).map((o) => o.value)

describe('settings hub — Playoffs tab — consolation plays for', () => {
  it('a league with the flag shows its value and saves a change as consolationPlaysFor', () => {
    render(
      <PlayoffsTab
        ctx={hubCtx({ settings: { playoff_structure: { consolation_plays_for: 'pick', consolation_plays_for_sets_draft_order: true } } })}
        canEdit
        hasAfCommissionerSub={false}
      />,
    )
    expect(select().value).toBe('pick')
    expect(options()).toEqual(['pick', 'cash', 'none'])
    expect(screen.queryByTestId('consolation-plays-for-unset')).toBeNull()
    fireEvent.change(select(), { target: { value: 'cash' } })
    expect(queuePatch).toHaveBeenCalledWith({ consolationPlaysFor: 'cash' })
  })

  it('an older league storing the sport default shows Not set, and choosing Draft pick saves it', () => {
    render(<PlayoffsTab ctx={hubCtx({ settings: { playoff_structure: { consolation_plays_for: 'pick' } } })} canEdit hasAfCommissionerSub={false} />)
    expect(select().value).toBe('')
    expect(options()).toEqual(['', 'pick', 'cash', 'none'])
    expect(screen.getByTestId('consolation-plays-for-unset').textContent).toMatch(/created before/)
    fireEvent.change(select(), { target: { value: 'pick' } })
    expect(queuePatch).toHaveBeenCalledWith({ consolationPlaysFor: 'pick' })
  })

  it('a member who cannot edit sees it disabled', () => {
    render(<PlayoffsTab ctx={hubCtx({})} canEdit={false} hasAfCommissionerSub={false} />)
    expect(select().disabled).toBe(true)
  })

  it('is not offered on an imported league', () => {
    render(<PlayoffsTab ctx={hubCtx({ platform: 'sleeper' })} canEdit hasAfCommissionerSub={false} />)
    expect(screen.queryByTestId('consolation-plays-for')).toBeNull()
  })

  it('has EN and ES strings', () => {
    for (const key of ['lsHub.po.playsFor', 'lsHub.po.playsForHelp', 'lsHub.po.playsForUnset', 'lsHub.po.playsForUnsetHelp', 'lsHub.po.playsFor.pick', 'lsHub.po.playsFor.cash', 'lsHub.po.playsFor.none']) {
      expect((translations.en as Record<string, string>)[key], key).toBeTruthy()
      expect((translationsEsParity as Record<string, string>)[key], key).toBeTruthy()
    }
    expect(translations.en['lsHub.po.playsFor.pick']).toBe('Draft pick')
  })
})
