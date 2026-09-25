import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * "Chimmy speaks up in league chat" — the commissioner's switch, in the Commissioner Hub's
 * Automations. Saved through the existing commissioner-gated `PATCH /api/league/settings`
 * settingsMerge as ONE top-level boolean, and kept across a re-import.
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { AutomationRecipes } from '@/components/core-app/commissioner/AutomationRecipes'
import { buildChimmySpeaksUpMerge, readChimmySpeaksUp } from '@/lib/league-chat/chimmyIdentity'
import { AF_OWNED_LEAGUE_SETTINGS_KEYS } from '@/lib/league/afOwnedLeagueSettings'
import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'

const recipes = (over: Partial<CommissionerHubData['recipes']> = {}): CommissionerHubData['recipes'] => ({
  values: { lineupReminder: false, weeklyRecap: true, inactivityWarning: false, votingDeadline: false, playoffAnnouncement: false },
  saved: false,
  updatedAt: null,
  sendEnabled: true,
  catalog: [],
  chimmySpeaksUp: true,
  ...over,
})

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  refresh.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('the stored switch', () => {
  it('is on unless the commissioner explicitly switched it off', () => {
    expect(readChimmySpeaksUp(null)).toBe(true)
    expect(readChimmySpeaksUp({})).toBe(true)
    expect(readChimmySpeaksUp({ chimmySpeaksUp: true })).toBe(true)
    expect(readChimmySpeaksUp({ chimmySpeaksUp: 'no' })).toBe(true)
    expect(readChimmySpeaksUp({ chimmySpeaksUp: false })).toBe(false)
  })

  it('is one top-level key, so a shallow settingsMerge cannot clobber anything else', () => {
    expect(buildChimmySpeaksUpMerge(false)).toEqual({ chimmySpeaksUp: false })
  })

  it('survives a re-import — it is an AllFantasy-owned settings key', () => {
    expect(AF_OWNED_LEAGUE_SETTINGS_KEYS).toContain('chimmySpeaksUp')
  })
})

describe('the Commissioner Hub switch', () => {
  it('turns Chimmy off through the commissioner-gated settings route', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    render(<AutomationRecipes leagueId="L1" recipes={recipes()} />)
    const toggle = screen.getByRole('switch', { name: /Chimmy speaks up in league chat: on/ })
    expect((toggle as HTMLInputElement).checked).toBe(true)

    fireEvent.click(toggle)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/league/settings')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ leagueId: 'L1', settingsMerge: { chimmySpeaksUp: false } })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(screen.getByRole('switch', { name: /Chimmy speaks up in league chat: off/ })).toBeTruthy()
  })

  it('puts the switch back and says so when the save is refused', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Commissioners only.' }), { status: 403 }))
    render(<AutomationRecipes leagueId="L1" recipes={recipes()} />)
    fireEvent.click(screen.getByRole('switch', { name: /Chimmy speaks up/ }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Commissioners only.')
    expect((screen.getByRole('switch', { name: /Chimmy speaks up in league chat: on/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('reads an older payload with no value as ON', () => {
    const older = recipes()
    delete (older as Partial<typeof older>).chimmySpeaksUp
    render(<AutomationRecipes leagueId="L1" recipes={older} />)
    expect((screen.getByRole('switch', { name: /Chimmy speaks up/ }) as HTMLInputElement).checked).toBe(true)
  })
})
