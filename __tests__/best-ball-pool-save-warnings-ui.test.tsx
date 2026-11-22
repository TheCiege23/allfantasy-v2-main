/**
 * Best ball pool warnings reach the commissioner on every save that can make the pool tight
 * (lib/bestball/poolCapacity.ts). The roster-settings PUT already showed them; these are the two saves that
 * returned them nowhere: the General tab's team count (league-settings PATCH) and the roster editor's
 * "Reset to League Default". Mocks only — fetch is stubbed.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { NFL_ROSTER_SLOTS, NFL_ROSTER_TEMPLATES } from '@/lib/nfl-roster/NflRosterTemplates'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})
vi.mock('@/lib/draft-room/emitLeagueDraftRoomRevalidate', () => ({ emitLeagueDraftRoomRevalidate: () => {} }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { GeneralTab } from '@/components/league-settings/tabs/GeneralTab'
import { RosterSettingsEditor } from '@/components/league-settings/RosterSettingsEditor'
import { clearSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'

const TIGHT = 'A 32-team league starts 32 of the about 32 K players every week.'

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('General tab: a tight team count says so', () => {
  beforeEach(() => clearSavedLeagueOverrides())

  function ctx() {
    return {
      league: {
        id: 'l1', name: 'Pool League', timezone: 'America/New_York', logoUrl: null, settings: {}, platform: 'manual',
        leagueSize: 28, waiverType: 'rolling', waiverBudget: 100, waiverMinBid: 0, waiverHours: 24,
      },
      displayLeague: { id: 'l1', name: 'Pool League', teamCount: 28 },
      isCommissioner: true,
    } as never
  }

  function stubPatch(body: Record<string, unknown>) {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('the warnings the save returns are shown under the team count', async () => {
    const fetchMock = stubPatch({ success: true, updatedFields: ['leagueSize'], bestBallPoolWarnings: [TIGHT], section: 'general' })
    const r = render(<GeneralTab ctx={ctx()} canEdit hasAfCommissionerSub={false} showWaivers={false} />)
    const input = r.getByTestId('league-settings-general-team-count')
    fireEvent.change(input, { target: { value: '32' } })
    fireEvent.blur(input)
    const warning = await r.findByTestId('league-settings-general-best-ball-pool-warning', undefined, { timeout: 3000 })
    expect(warning.textContent).toContain(TIGHT)
    // The save really was the team count.
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { updates: Record<string, unknown> }
    expect(sent.updates).toEqual({ leagueSize: 32 })
  })

  it('a save that did not change the team count leaves the field alone', async () => {
    stubPatch({ success: true, updatedFields: ['name'], bestBallPoolWarnings: [TIGHT], section: 'general' })
    const r = render(<GeneralTab ctx={ctx()} canEdit hasAfCommissionerSub={false} showWaivers={false} />)
    fireEvent.change(r.getByTestId('league-settings-general-name'), { target: { value: 'Renamed' } })
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1), { timeout: 3000 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(r.queryByTestId('league-settings-general-best-ball-pool-warning')).toBeNull()
  })
})

describe('Roster editor: Reset to League Default shows the pool warning', () => {
  it('the reset response warning joins the roster warnings', async () => {
    const tpl = NFL_ROSTER_TEMPLATES[0]!
    const getBody = {
      isCommissioner: true, slotDefs: NFL_ROSTER_SLOTS, sport: 'NFL', defaultTemplateKey: tpl.key,
      config: { templateKey: 'custom', slots: { ...tpl.slots, K: 0 }, isCustom: true },
      templates: NFL_ROSTER_TEMPLATES, unifiedConfig: { rosterMatchesTemplate: false, rosterWarnings: [] },
    }
    const resetBody = {
      ok: true, config: { templateKey: tpl.key, slots: tpl.slots, isCustom: false },
      unifiedConfig: { rosterMatchesTemplate: true, rosterWarnings: [] }, draftRounds: null,
      bestBallPoolWarnings: [TIGHT],
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200, json: async () => (String(url).endsWith('/reset-default') ? resetBody : getBody),
    })))
    const r = render(<RosterSettingsEditor leagueId="l1" sport="NFL" />)
    const reset = await r.findByText('Reset to League Default')
    fireEvent.click(reset)
    await waitFor(() => expect(r.container.textContent).toContain(TIGHT))
  })
})
