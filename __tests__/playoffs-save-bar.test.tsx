// @vitest-environment jsdom
/**
 * Playoffs used to be the one League Settings page with three ways to save: the quick fields
 * saved through the page's bar, while the bracket format and the playoff stages each drew their
 * own Save button below. On a League Settings page both editors now join the page's
 * "Save changes" bar and hide their own button; outside one (the older settings modal) they keep it.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  return { useLanguage: () => ({ language: 'en', t: (k: string) => dict.en[k] ?? k, setLanguage: () => {} }) }
})
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))

import { SettingsSaveScope } from '@/components/league-settings/home/SettingsSaveScope'
import { PlayoffBracketFormatCard } from '@/components/league-settings/PlayoffBracketFormatCard'
import { PlayoffSettingsEditor } from '@/components/league-settings/PlayoffSettingsEditor'
import { checkByePlan, naturalByePlan, validByePlans } from '@/lib/playoff-brackets/byePlan'

function option(teams: number, plan: number[]) {
  const c = checkByePlan(teams, plan)
  if (!c.ok) throw new Error(c.error)
  const natural = plan.join() === naturalByePlan(teams).join()
  return { plan, natural, rounds: c.rounds, roundCount: c.roundCount, finalWeek: 14 + c.roundCount, fitsSeason: true }
}
const bracketView = (teams: number, over: Record<string, unknown> = {}) => ({
  playoffTeams: teams, savedPlayoffTeams: teams, plan: naturalByePlan(teams),
  options: validByePlans(teams).map((p) => option(teams, p)), lastWeek: 18, isPremium: true, locked: false, ...over,
})
const stagesView = {
  sport: 'NBA',
  isPremium: true,
  stages: [{ id: 'third_place', label: 'Third-place game', description: '', shortensSeason: false, additionalWeeks: 0, defaultEnabled: false, premium: false }],
  config: { sport: 'NBA', includedStages: [], startMode: 'default', adjustedPlayoffStartWeek: null, adjustedPlayoffWeeks: null, premiumFeaturesUsed: false },
}
const json = (b: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(b) })

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CUSTOM = '#1 sits out 3 rounds · #2 sits out 2 rounds · #3 gets a bye'

describe('bracket format on a League Settings page', () => {
  it('has no Save button of its own; the page bar saves the chosen bracket', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? json({ ok: true }) : json(bracketView(5)),
    )
    render(
      <SettingsSaveScope>
        <PlayoffBracketFormatCard leagueId="L" playoffTeams={5} canEdit />
      </SettingsSaveScope>,
    )
    fireEvent.click(await screen.findByText(CUSTOM))
    expect(screen.queryByText('Save bracket format')).toBeNull()

    fireEvent.click(screen.getByTestId('lsh-save-changes'))
    await waitFor(() => expect(screen.getByTestId('lsh-savebar').textContent).toContain('Saved'))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(JSON.parse(put[1].body)).toEqual({ playoffTeams: 5, byePlan: [3, 2, 1, 0, 0] })
  })

  it('a format that needs AF Commissioner is not sent; the bar reports the save did not go through', async () => {
    fetchMock.mockImplementation(() => json(bracketView(5, { isPremium: false })))
    render(
      <SettingsSaveScope>
        <PlayoffBracketFormatCard leagueId="L" playoffTeams={5} canEdit />
      </SettingsSaveScope>,
    )
    fireEvent.click(await screen.findByText(CUSTOM))
    fireEvent.click(screen.getByTestId('lsh-save-changes'))
    await waitFor(() => expect(screen.getByTestId('lsh-savebar').textContent).toContain('did not save'))
    expect(screen.getByText('This bracket format needs AF Commissioner.')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('outside a League Settings page it keeps its own Save button', async () => {
    fetchMock.mockImplementation(() => json(bracketView(5)))
    render(<PlayoffBracketFormatCard leagueId="L" playoffTeams={5} canEdit />)
    await screen.findByText('Standard bracket')
    expect(screen.getByText('Save bracket format')).toBeTruthy()
  })
})

describe('playoff stages on a League Settings page', () => {
  it('has no Save button of its own; the page bar saves the stages', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return json(stagesView)
      const body = JSON.parse(String(init.body))
      if (body.preview) return json({ adjustment: null })
      return json({ config: { ...stagesView.config, includedStages: body.includedStages } })
    })
    render(
      <SettingsSaveScope>
        <PlayoffSettingsEditor leagueId="L" />
      </SettingsSaveScope>,
    )
    fireEvent.click(await screen.findByText('Third-place game'))
    expect(screen.queryByText('Save playoff settings')).toBeNull()

    fireEvent.click(screen.getByTestId('lsh-save-changes'))
    await waitFor(() => expect(screen.getByTestId('lsh-savebar').textContent).toContain('Saved'))
    const saves = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT' && !JSON.parse(String(init.body)).preview)
    expect(saves).toHaveLength(1)
    expect(JSON.parse(saves[0]![1].body)).toEqual({ includedStages: ['third_place'] })
  })
})
