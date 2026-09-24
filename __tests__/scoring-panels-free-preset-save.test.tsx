import React from 'react'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NflScoringSettingsPanel } from '@/components/league-settings/NflScoringSettingsPanel'
import { NcaafScoringSettingsPanel } from '@/components/league-settings/NcaafScoringSettingsPanel'
import { NbaScoringSettingsPanel } from '@/components/league-settings/NbaScoringSettingsPanel'
import { NcaabScoringSettingsPanel } from '@/components/league-settings/NcaabScoringSettingsPanel'
import { MlbScoringSettingsPanel } from '@/components/league-settings/MlbScoringSettingsPanel'
import { NhlScoringSettingsPanel } from '@/components/league-settings/NhlScoringSettingsPanel'
import { SoccerScoringSettingsPanel } from '@/components/league-settings/SoccerScoringSettingsPanel'

/*
 * 🛑 A FREE COMMISSIONER MUST BE ABLE TO SWITCH SCORING PRESETS.
 *
 * Every sport's PUT route treats ANY `rules` in the body as a premium (custom-table)
 * edit and answers 403 premiumRequired without `advanced_scoring`. Every panel used
 * to send `rules: editedRules` on every save — so a plain preset switch (AllFantasy →
 * Yahoo) was refused for every free commissioner, in all seven sports. #1213 fixed
 * NFL; this covers the other six and pins NFL so it cannot drift back.
 *
 * The other half matters as much: editing any value switches the panel to "custom",
 * and a custom save MUST still carry the rules — leaving them out would silently save
 * the preset instead of what a paying commissioner typed.
 */

vi.mock('@/components/subscription/SubscriptionGateModal', () => ({
  SubscriptionGateModal: () => null,
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

type Case = {
  sport: string
  route: string
  yahooKey: string
  Panel: React.ComponentType<{ leagueId: string; isCommissioner?: boolean }>
}

const CASES: Case[] = [
  { sport: 'NFL', route: 'nfl-scoring', yahooKey: 'yahoo_default', Panel: NflScoringSettingsPanel },
  { sport: 'NCAAF', route: 'ncaaf-scoring', yahooKey: 'yahoo_compatible', Panel: NcaafScoringSettingsPanel },
  { sport: 'NBA', route: 'nba-scoring', yahooKey: 'yahoo_default', Panel: NbaScoringSettingsPanel },
  { sport: 'NCAAB', route: 'ncaab-scoring', yahooKey: 'yahoo_compatible', Panel: NcaabScoringSettingsPanel },
  { sport: 'MLB', route: 'mlb-scoring', yahooKey: 'yahoo_default', Panel: MlbScoringSettingsPanel },
  { sport: 'NHL', route: 'nhl-scoring', yahooKey: 'yahoo_default', Panel: NhlScoringSettingsPanel },
  { sport: 'SOCCER', route: 'soccer-scoring', yahooKey: 'yahoo_compatible', Panel: SoccerScoringSettingsPanel },
]

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
}

function mockApi(c: Case) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    expect(String(url)).toContain(`/${c.route}`)
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      return jsonResponse({ ok: true, config: { presetKey: body.presetKey, rules: body.rules ?? {} } })
    }
    return jsonResponse({
      // A free commissioner on the default preset.
      isPremium: false,
      config: { presetKey: 'af_default', rules: {}, premiumFeaturesUsed: false },
      presets: [
        { key: 'af_default', label: 'AllFantasy', description: '', rules: {} },
        // A real preset's values differ from the one saved, and four of the panels only
        // enable Save when the VALUES change — so the fixture must differ too.
        { key: c.yahooKey, label: 'Yahoo', description: '', rules: { yahoo_marker_stat: 99 } },
      ],
    })
  })
}

function putBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

beforeEach(() => {
  fetchMock.mockReset()
})
afterEach(() => cleanup())

describe.each(CASES)('$sport scoring panel', (c) => {
  it('a free commissioner switching presets sends NO rules (so the route does not 403 it)', async () => {
    mockApi(c)
    render(<c.Panel leagueId="league-1" isCommissioner />)

    const save = await screen.findByRole('button', { name: /Save Scoring/ })
    fireEvent.click(screen.getByRole('button', { name: /^Yahoo$/ }))
    await waitFor(() => expect(save).not.toBeDisabled())
    fireEvent.click(save)

    await waitFor(() => expect(putBodies()).toHaveLength(1))
    const [body] = putBodies()
    expect(body.presetKey).toBe(c.yahooKey)
    expect(body).not.toHaveProperty('rules')
  })

  it('an edited value is saved as a custom table WITH its rules', async () => {
    mockApi(c)
    render(<c.Panel leagueId="league-1" isCommissioner />)

    const save = await screen.findByRole('button', { name: /Save Scoring/ })
    const [firstValue] = screen.getAllByRole('spinbutton')
    fireEvent.change(firstValue, { target: { value: '7' } })
    await waitFor(() => expect(save).not.toBeDisabled())
    fireEvent.click(save)

    await waitFor(() => expect(putBodies()).toHaveLength(1))
    const [body] = putBodies()
    expect(body.presetKey).toBe('custom')
    expect(body.rules).toEqual(expect.objectContaining({}))
    expect(Object.values(body.rules as Record<string, number>)).toContain(7)
  })
})
