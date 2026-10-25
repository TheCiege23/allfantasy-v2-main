import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Settings → Home page (2026-10-24). The ask: as plain as the import picker, and INSTANT — no Save
 * button. A flip shows at once, saves the whole list, and a failed save puts the switch back.
 */

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { HomeSectionsSettingsSection } from '@/app/settings/components/sections/HomeSectionsSettingsSection'

const profile = (hidden: string[] = []) => ({ notificationPreferences: { hiddenHomeSections: hidden } }) as never
const row = (id: string) => document.querySelector(`[data-home-section="${id}"]`) as HTMLElement
const switchOf = (id: string) => row(id).querySelector('input[role="switch"]') as HTMLInputElement

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('Settings → Home page', () => {
  it('shows every section ON by default, with what it also silences', () => {
    render(<HomeSectionsSettingsSection profile={profile()} onRefetch={vi.fn()} />)
    expect(switchOf('league-trades').checked).toBe(true)
    expect(row('league-trades').dataset.shown).toBe('true')
    expect(row('league-trades').textContent).toMatch(/Turning this off also stops/)
    // The two rows whose "off" also silences an alert you must act on warn about it.
    expect(screen.getByTestId('home-section-warn-drafts').textContent).toMatch(/on-the-clock alerts/)
    expect(screen.getByTestId('home-section-warn-league-trades').textContent).toMatch(/trade offers sent to you/)
    expect(screen.queryByTestId('home-section-warn-rivals')).toBeNull()
    expect(screen.getByTestId('home-sections-count').textContent).toBe('17 of 17 sections showing')
  })

  it('flips instantly and saves the whole list on the click — no Save button', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const onRefetch = vi.fn()
    render(<HomeSectionsSettingsSection profile={profile(['rivals'])} onRefetch={onRefetch} />)
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull()

    fireEvent.click(switchOf('league-trades'))
    // Before the request resolves, the row already reads OFF.
    expect(row('league-trades').dataset.shown).toBe('false')
    expect(row('league-trades').textContent).toMatch(/Hidden/)

    await waitFor(() => expect(onRefetch).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/user/profile')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({
      notificationPreferences: { hiddenHomeSections: ['league-trades', 'rivals'] },
    })
  })

  it('two quick taps both land, in order, and the last write carries both', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    render(<HomeSectionsSettingsSection profile={profile()} onRefetch={vi.fn()} />)
    fireEvent.click(switchOf('streak'))
    fireEvent.click(switchOf('career'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).notificationPreferences.hiddenHomeSections).toEqual([
      'streak',
      'career',
    ])
  })

  it('a failed save puts the switch back and says so', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    render(<HomeSectionsSettingsSection profile={profile()} onRefetch={vi.fn()} />)
    fireEvent.click(switchOf('matchups'))
    expect(switchOf('matchups').checked).toBe(false)
    await waitFor(() => expect(switchOf('matchups').checked).toBe(true))
    expect(screen.getByRole('status').textContent).toMatch(/Couldn't save/)
  })

  it('"Show everything" clears the list in one write', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    render(<HomeSectionsSettingsSection profile={profile(['streak', 'rivals'])} onRefetch={vi.fn()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show everything' }))
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).notificationPreferences.hiddenHomeSections).toEqual([])
    expect(switchOf('streak').checked).toBe(true)
  })
})
