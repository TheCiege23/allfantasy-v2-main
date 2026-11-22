/**
 * The web Playoff Settings panel (components/app/settings/PlayoffSettingsPanel.tsx):
 *
 *   - dynasty / keeper with "plays for: Draft pick" — "Toilet bowl: top pick goes to" (the final's
 *     loser by default, or its winner), sent as `consolationPickGoesTo` only once touched;
 *   - redraft — Draft pick is not offered as a choice that does something: hidden unless it is the
 *     stored value, then labelled as having no effect, and the toilet bowl choice is not shown.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const section = vi.hoisted(() => ({ config: null as Record<string, unknown> | null }))
vi.mock('@/hooks/useLeagueSectionData', () => ({
  useLeagueSectionData: () => ({ data: section.config, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import PlayoffSettingsPanel from '@/components/app/settings/PlayoffSettingsPanel'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const config = (over: Record<string, unknown>) => ({
  playoff_team_count: 6, playoff_weeks: 3, playoff_start_week: 15, first_round_byes: 2, matchup_length: 1,
  consolation_bracket_enabled: false, toilet_bowl_enabled: true, championship_length: 1,
  consolation_plays_for: 'pick', consolation_pick_goes_to: 'loser', draft_order_carries_over: true,
  sport: 'NFL', variant: null, ...over,
})

async function openEditor() {
  const toggle = await screen.findByTestId('playoff-settings-edit-toggle')
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(toggle)
}
const playsFor = () => screen.getByLabelText('Consolation plays for') as HTMLSelectElement
const goesTo = () => screen.queryByLabelText('Toilet bowl: top pick goes to') as HTMLSelectElement | null

describe('web playoff panel — toilet bowl pick and redraft', () => {
  it('dynasty with Draft pick: the choice defaults to the loser and is saved once changed', async () => {
    section.config = config({})
    render(<PlayoffSettingsPanel leagueId="L" />)
    await openEditor()
    expect(goesTo()!.value).toBe('loser')
    fireEvent.change(goesTo()!, { target: { value: 'winner' } })
    fireEvent.click(screen.getByTestId('playoff-settings-save'))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')!
    const body = JSON.parse(String((put[1] as RequestInit).body))
    expect(body.consolationPickGoesTo).toBe('winner')
    // "Plays for" was not touched, so the save does not send it.
    expect(body).not.toHaveProperty('consolationPlaysFor')
  })

  it('Cash hides the choice', async () => {
    section.config = config({})
    render(<PlayoffSettingsPanel leagueId="L" />)
    await openEditor()
    fireEvent.change(playsFor(), { target: { value: 'cash' } })
    expect(goesTo()).toBeNull()
  })

  it('redraft: no Draft pick unless stored, then marked no effect; no toilet bowl choice', async () => {
    section.config = config({ consolation_plays_for: 'cash', draft_order_carries_over: false })
    render(<PlayoffSettingsPanel leagueId="L" />)
    await openEditor()
    expect(Array.from(playsFor().options).map((o) => o.value)).toEqual(['none', 'cash'])
    expect(screen.getByTestId('playoff-settings-redraft-plays-for-note').textContent).toMatch(/starts fresh/)
    expect(goesTo()).toBeNull()
    cleanup()

    section.config = config({ consolation_plays_for: 'pick', draft_order_carries_over: false })
    render(<PlayoffSettingsPanel leagueId="L" />)
    await openEditor()
    const pick = Array.from(playsFor().options).find((o) => o.value === 'pick')!
    expect(pick.textContent).toMatch(/no effect in redraft/)
    expect(goesTo()).toBeNull()
  })
})
