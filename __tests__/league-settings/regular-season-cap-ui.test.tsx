/**
 * The settings UI never offers a playoff start past week 25 to a redraft or keeper league — a regular
 * season of at most 24 weeks (lib/redraft/regularSeasonCap.ts). Covered: the native settings hub
 * (Playoffs tab) and the commissioner settings modal. Dynasty is not capped.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: true }) }))
vi.mock('@/hooks/useSubscriptionGate', () => ({ useSubscriptionGateOptional: () => null }))
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({
  useLeagueSettingsSectionAutosave: () => ({ queuePatch: vi.fn(), saving: false }),
}))

import { PlayoffsTab } from '@/components/league-settings/tabs/PlayoffsTab'
import { PlayoffSettingsPanel } from '@/app/league/[leagueId]/components/settings/PlayoffSettingsPanel'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stages: [], sport: 'NHL', config: null }) }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const hubCtx = (league: Record<string, unknown>) =>
  ({ league: { id: 'L', platform: 'manual', teams: [], leagueSize: 12, playoffTeams: 6, settings: {}, ...league } }) as never

/** The quick field's start-week input: the number input that is not the field size. */
function startWeekInput(): HTMLInputElement {
  const inputs = [...document.querySelectorAll('input[type="number"]')] as HTMLInputElement[]
  return inputs.find((el) => el.min === '1')!
}

describe('settings hub — Playoffs tab: start week max', () => {
  it.each([
    ['NHL', 'redraft', 25],
    ['MLB', 'keeper', 25],
    ['NBA', 'redraft', 25],
    ['NFL', 'redraft', 25],
  ])('%s %s: at most week %i', (sport, leagueType, max) => {
    render(<PlayoffsTab ctx={hubCtx({ sport, leagueType, playoffStartWeek: 22 })} canEdit hasAfCommissionerSub={false} />)
    expect(Number(startWeekInput().max)).toBe(max)
  })

  it('a league type without the cap keeps the season-length max (NHL dynasty: 28)', () => {
    render(<PlayoffsTab ctx={hubCtx({ sport: 'NHL', leagueType: 'dynasty', isDynasty: true, playoffStartWeek: 25 })} canEdit hasAfCommissionerSub={false} />)
    expect(Number(startWeekInput().max)).toBe(28)
  })
})

function startWeekSelect(): HTMLSelectElement {
  return screen.getAllByRole('combobox').find((el) =>
    [...(el as HTMLSelectElement).options].some((o) => /^Week \d+$/.test(o.textContent ?? '')),
  ) as HTMLSelectElement
}
const offered = () => [...startWeekSelect().options].map((o) => Number(o.value))

describe('commissioner modal — Playoffs start week', () => {
  it('NHL redraft (28-week season): weeks 21–25, never 26–28', () => {
    render(<PlayoffSettingsPanel initialData={{ sport: 'NHL', leagueType: 'redraft', leagueSize: 12, playoffTeams: 6, playoffStartWeek: 25, championshipLength: 2 } as never} canEdit debouncedSave={vi.fn()} />)
    expect(offered()).toEqual([21, 22, 23, 24, 25])
  })

  it('MLB keeper (27-week season): weeks 20–25', () => {
    render(<PlayoffSettingsPanel initialData={{ sport: 'MLB', leagueType: 'keeper', leagueSize: 12, playoffTeams: 6, playoffStartWeek: 24 } as never} canEdit debouncedSave={vi.fn()} />)
    expect(offered()).toEqual([20, 21, 22, 23, 24, 25])
  })

  it('NFL redraft is unchanged: weeks 10–17', () => {
    render(<PlayoffSettingsPanel initialData={{ sport: 'NFL', leagueType: 'redraft', leagueSize: 12, playoffTeams: 6, playoffStartWeek: 15 } as never} canEdit debouncedSave={vi.fn()} />)
    expect(offered()).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
  })

  it('a legacy week past the cap stays listed so the field shows what is saved', () => {
    render(<PlayoffSettingsPanel initialData={{ sport: 'NHL', leagueType: 'redraft', leagueSize: 8, playoffTeams: 4, playoffStartWeek: 26, championshipLength: 2 } as never} canEdit debouncedSave={vi.fn()} />)
    expect(offered()).toEqual([21, 22, 23, 24, 25, 26])
  })

  it('NHL dynasty is not capped: weeks 21–28', () => {
    render(<PlayoffSettingsPanel initialData={{ sport: 'NHL', leagueType: 'dynasty', isDynasty: true, leagueSize: 12, playoffTeams: 6, playoffStartWeek: 25 } as never} canEdit debouncedSave={vi.fn()} />)
    expect(offered()).toEqual([21, 22, 23, 24, 25, 26, 27, 28])
  })
})
