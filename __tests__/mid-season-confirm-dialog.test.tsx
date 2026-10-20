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
 * A mid-season scoring save is answered 409 `mid_season_confirmation_required` by every scoring
 * route (lib/league/settingsLifecycleGate.ts). The panel must show the warning and, on confirm,
 * re-send the SAME request with `confirmMidSeasonChange: true` — and on cancel send nothing more.
 */

vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

type Case = { sport: string; route: string; yahooKey: string; Panel: React.ComponentType<{ leagueId: string; isCommissioner?: boolean }> }

const CASES: Case[] = [
  { sport: 'NFL', route: 'nfl-scoring', yahooKey: 'yahoo_default', Panel: NflScoringSettingsPanel },
  { sport: 'NCAAF', route: 'ncaaf-scoring', yahooKey: 'yahoo_compatible', Panel: NcaafScoringSettingsPanel },
  { sport: 'NBA', route: 'nba-scoring', yahooKey: 'yahoo_default', Panel: NbaScoringSettingsPanel },
  { sport: 'NCAAB', route: 'ncaab-scoring', yahooKey: 'yahoo_compatible', Panel: NcaabScoringSettingsPanel },
  { sport: 'MLB', route: 'mlb-scoring', yahooKey: 'yahoo_default', Panel: MlbScoringSettingsPanel },
  { sport: 'NHL', route: 'nhl-scoring', yahooKey: 'yahoo_default', Panel: NhlScoringSettingsPanel },
  { sport: 'SOCCER', route: 'soccer-scoring', yahooKey: 'yahoo_compatible', Panel: SoccerScoringSettingsPanel },
]

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

function mockMidSeasonApi() {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      if (body.confirmMidSeasonChange !== true) {
        return json(
          {
            code: 'mid_season_confirmation_required',
            message:
              "This league's season has started. Changing scoring/roster settings will recalculate scores and may make some lineups invalid. Confirm to continue.",
            error: 'confirmation required',
          },
          409,
        )
      }
      return json({ ok: true, config: { presetKey: body.presetKey, rules: body.rules ?? {} } })
    }
    return json({
      isPremium: false,
      config: { presetKey: 'af_default', rules: {}, premiumFeaturesUsed: false },
      presets: [
        { key: 'af_default', label: 'AllFantasy', description: '', rules: {} },
        { key: 'yahoo_default', label: 'Yahoo', description: '', rules: { yahoo_marker_stat: 99 } },
        { key: 'yahoo_compatible', label: 'Yahoo', description: '', rules: { yahoo_marker_stat: 99 } },
      ],
    })
  })
}

const putBodies = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>)

async function startSave(c: Case) {
  mockMidSeasonApi()
  render(<c.Panel leagueId="league-1" isCommissioner />)
  const save = await screen.findByRole('button', { name: /Save Scoring/ })
  fireEvent.change(screen.getByRole('combobox', { name: /Scoring preset/ }), { target: { value: c.yahooKey } })
  await waitFor(() => expect(save).not.toBeDisabled())
  fireEvent.click(save)
  return screen.findByTestId('mid-season-confirm-dialog')
}

beforeEach(() => fetchMock.mockReset())
afterEach(() => cleanup())

describe.each(CASES)('$sport scoring panel, mid-season save', (c) => {
  it('shows the warning, and Confirm re-sends the same change with confirmMidSeasonChange', async () => {
    const dialog = await startSave(c)
    expect(dialog.textContent).toMatch(/season has started/i)
    expect(putBodies()).toHaveLength(1)

    fireEvent.click(screen.getByTestId('mid-season-confirm-accept'))

    await waitFor(() => expect(putBodies()).toHaveLength(2))
    const [first, second] = putBodies()
    expect(first).not.toHaveProperty('confirmMidSeasonChange')
    expect(second).toEqual({ ...first, confirmMidSeasonChange: true })
    await screen.findByText(/saved successfully/i)
  })

  it('Cancel sends nothing more and reports the change as not saved', async () => {
    await startSave(c)
    fireEvent.click(screen.getByTestId('mid-season-confirm-cancel'))
    await screen.findByText(/Change not saved/)
    expect(putBodies()).toHaveLength(1)
  })
})
