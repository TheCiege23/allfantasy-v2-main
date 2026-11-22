/**
 * The native settings hub's Playoffs tab offers "Consolation plays for" and saves it as
 * `consolationPlaysFor` through the league settings PATCH (execute-league-settings-patch stores it in
 * `settings.playoff_structure` with the draft-order flag — lib/playoff-runtime/consolationPlaysFor.ts).
 *
 * A league created before the setting moved the draft order shows "Not set" rather than the sport
 * default it stores: saving a choice is what opts it in, so it must not look already chosen.
 *
 * Dynasty / keeper leagues with Draft pick also get "Toilet bowl: top pick goes to" (loser by default).
 * A redraft league starts fresh: Draft pick is not offered as a choice that does anything.
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
  ({ league: { id: 'L', sport: 'NFL', platform: 'manual', teams: [], leagueSize: 12, playoffTeams: 6, playoffStartWeek: 15, settings: {}, leagueType: 'dynasty', isDynasty: true, ...league } }) as never

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

  it('dynasty with Draft pick: the toilet bowl choice shows, defaults to the loser, and saves', () => {
    render(
      <PlayoffsTab
        ctx={hubCtx({ settings: { playoff_structure: { consolation_plays_for: 'pick', consolation_plays_for_sets_draft_order: true } } })}
        canEdit
        hasAfCommissionerSub={false}
      />,
    )
    const goesTo = screen.getByTestId('consolation-pick-goes-to').querySelector('select') as HTMLSelectElement
    expect(goesTo.value).toBe('loser')
    expect(Array.from(goesTo.options).map((o) => o.value)).toEqual(['loser', 'winner'])
    fireEvent.change(goesTo, { target: { value: 'winner' } })
    expect(queuePatch).toHaveBeenCalledWith({ consolationPickGoesTo: 'winner' })
  })

  it('a keeper league storing winner shows it', () => {
    render(
      <PlayoffsTab
        ctx={hubCtx({ leagueType: 'keeper', isDynasty: false, settings: { playoff_structure: { consolation_plays_for: 'pick', consolation_plays_for_sets_draft_order: true, consolation_pick_goes_to: 'winner' } } })}
        canEdit
        hasAfCommissionerSub={false}
      />,
    )
    expect((screen.getByTestId('consolation-pick-goes-to').querySelector('select') as HTMLSelectElement).value).toBe('winner')
  })

  it('the toilet bowl choice is hidden unless it plays for Draft pick', () => {
    render(
      <PlayoffsTab
        ctx={hubCtx({ settings: { playoff_structure: { consolation_plays_for: 'cash', consolation_plays_for_sets_draft_order: true } } })}
        canEdit
        hasAfCommissionerSub={false}
      />,
    )
    expect(screen.queryByTestId('consolation-pick-goes-to')).toBeNull()
  })

  it('redraft: Draft pick is not offered; a stored Draft pick is kept but marked as having no effect', () => {
    render(<PlayoffsTab ctx={hubCtx({ leagueType: 'redraft', isDynasty: false, settings: { playoff_structure: { consolation_plays_for: 'cash', consolation_plays_for_sets_draft_order: true } } })} canEdit hasAfCommissionerSub={false} />)
    expect(options()).toEqual(['cash', 'none'])
    expect(screen.getByTestId('consolation-plays-for-redraft').textContent).toMatch(/starts fresh/)
    expect(screen.queryByTestId('consolation-pick-goes-to')).toBeNull()
    cleanup()

    render(<PlayoffsTab ctx={hubCtx({ leagueType: 'redraft', isDynasty: false, settings: { playoff_structure: { consolation_plays_for: 'pick', consolation_plays_for_sets_draft_order: true } } })} canEdit hasAfCommissionerSub={false} />)
    expect(select().value).toBe('pick')
    expect(options()).toEqual(['pick', 'cash', 'none'])
    expect(select().options[0].textContent).toMatch(/no effect in redraft/)
    expect(screen.queryByTestId('consolation-pick-goes-to')).toBeNull()
    cleanup()

    // An older redraft league (no flag) shows Not set without Draft pick among the choices.
    render(<PlayoffsTab ctx={hubCtx({ leagueType: 'redraft', isDynasty: false, settings: { playoff_structure: { consolation_plays_for: 'pick' } } })} canEdit hasAfCommissionerSub={false} />)
    expect(options()).toEqual(['', 'cash', 'none'])
    expect(screen.queryByTestId('consolation-plays-for-unset')).toBeNull()
  })

  it('has EN and ES strings', () => {
    for (const key of [
      'lsHub.po.playsFor', 'lsHub.po.playsForHelp', 'lsHub.po.playsForUnset', 'lsHub.po.playsForUnsetHelp', 'lsHub.po.playsFor.pick', 'lsHub.po.playsFor.cash', 'lsHub.po.playsFor.none',
      'lsHub.po.playsFor.pickRedraft', 'lsHub.po.playsForRedraftHelp', 'lsHub.po.pickGoesTo', 'lsHub.po.pickGoesTo.loser', 'lsHub.po.pickGoesTo.winner', 'lsHub.po.pickGoesToHelp',
    ]) {
      expect((translations.en as Record<string, string>)[key], key).toBeTruthy()
      expect((translationsEsParity as Record<string, string>)[key], key).toBeTruthy()
    }
    expect(translations.en['lsHub.po.playsFor.pick']).toBe('Draft pick')
  })
})
