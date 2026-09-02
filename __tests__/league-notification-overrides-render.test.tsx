import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeagueNotificationOverridesCard } from '../components/notification-settings/LeagueNotificationOverridesCard'
import type { NotificationPreferences } from '../lib/notification-settings/types'

/**
 * Does the card actually mount, and does it say the right thing in each state?
 *
 * The sibling suite (league-notification-overrides.test.ts) proves the EDITS are correct
 * through the real server merge. Neither that nor the typecheck ever renders this
 * component, and the settings page redirects to /login so it cannot be opened in a browser
 * here. This is the layer that would catch a card that throws on mount, or one whose
 * "no leagues" and "could not load" states are the same sentence.
 */

const CATEGORIES = ['trade_proposals', 'chat_mentions'] as const
const LABELS = {
  trade_proposals: 'Trade proposals',
  chat_mentions: 'Chat mentions',
} as Record<string, string>

function renderCard(
  prefs: NotificationPreferences,
  onChange = vi.fn(),
) {
  render(
    <LeagueNotificationOverridesCard
      prefs={prefs}
      onChange={onChange}
      categoryIds={CATEGORIES as unknown as never}
      categoryLabels={LABELS as never}
    />,
  )
  return onChange
}

function mockLeagues(leagues: unknown) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ leagues }),
  } as Response)
}

describe('LeagueNotificationOverridesCard', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('lists the leagues it fetched', async () => {
    mockLeagues([
      { id: 'l1', name: 'Dynasty Warriors' },
      { id: 'l2', name: 'The Main League' },
    ])
    renderCard({ globalEnabled: true })

    await waitFor(() => expect(screen.getByText('Dynasty Warriors')).toBeTruthy())
    expect(screen.getByText('The Main League')).toBeTruthy()
  })

  it('muting a league reports the new preferences upward', async () => {
    mockLeagues([{ id: 'l1', name: 'Dynasty Warriors' }])
    const onChange = renderCard({ globalEnabled: true })

    await waitFor(() => expect(screen.getByTestId('league-override-select-l1')).toBeTruthy())
    fireEvent.change(screen.getByTestId('league-override-select-l1'), {
      target: { value: 'muted' },
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].leagues.l1).toEqual({ enabled: false })
  })

  it('"Follow my settings" sends {} rather than dropping the key', async () => {
    // The render-level guard on the silent-revert bug: a delete would show up here as an
    // absent key, and this asserts the neutral value actually leaves the component.
    mockLeagues([{ id: 'l1', name: 'Dynasty Warriors' }])
    const onChange = renderCard({ globalEnabled: true, leagues: { l1: { enabled: false } } })

    await waitFor(() => expect(screen.getByTestId('league-override-select-l1')).toBeTruthy())
    fireEvent.change(screen.getByTestId('league-override-select-l1'), {
      target: { value: 'global' },
    })

    const next = onChange.mock.calls[0][0]
    expect(next.leagues).toHaveProperty('l1')
    expect(next.leagues.l1).toEqual({})
  })

  it('says so, and disables the controls, when notifications are off account-wide', async () => {
    // A control that looks live and changes nothing is the failure this text exists to stop.
    mockLeagues([{ id: 'l1', name: 'Dynasty Warriors' }])
    renderCard({ globalEnabled: false })

    await waitFor(() => expect(screen.getByTestId('league-overrides-globally-off')).toBeTruthy())
    expect((screen.getByTestId('league-override-select-l1') as HTMLSelectElement).disabled).toBe(true)
  })

  it('distinguishes "could not load" from "you have no leagues"', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response)
    renderCard({ globalEnabled: true })

    await waitFor(() => expect(screen.getByTestId('league-overrides-load-failed')).toBeTruthy())
    expect(screen.queryByText(/Once you join or import a league/)).toBeNull()
  })

  it('shows the empty state when the account genuinely has no leagues', async () => {
    mockLeagues([])
    renderCard({ globalEnabled: true })

    await waitFor(() => expect(screen.getByText(/Once you join or import a league/)).toBeTruthy())
    expect(screen.queryByTestId('league-overrides-load-failed')).toBeNull()
  })
})
