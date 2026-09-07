import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import LeagueRecoveryClient from '@/app/admin/league-recovery/LeagueRecoveryClient'

/**
 * 🛑 THIS TESTS THE SAFETY PROPERTIES OF THE SCREEN, NOT THAT IT RENDERS.
 *
 * The API refuses an unauthorised caller; nothing about the UI can add security. What the UI is
 * responsible for is not making a destructive action EASY TO HIT BY ACCIDENT — a live-draft pause
 * one click from a metrics tile is a different failure from an ungated endpoint, and no server test
 * can see it.
 *
 * So the assertions here are about what is DISABLED and what is ABSENT:
 *   · the disruptive buttons stay disabled until the league name is typed exactly
 *   · the lifecycle dropdown offers ONLY the server's allowed set, never all ten enum values
 *   · a coerced lifecycle state is labelled as a fallback rather than stated as fact
 */

const PAYLOAD = {
  ok: true,
  snapshot: {
    league: {
      id: 'lg-1', name: 'Sunday Money', sport: 'NFL', season: 2026, platform: 'native',
      lifecycleState: 'in_season', locked: false, emergencyPaused: false, status: 'active',
    },
    draftSession: { id: 'ds-1' },
    waiverRunsRecent: [],
    rosterCount: 12,
  },
  lifecycle: {
    raw: 'in_season',
    normalized: 'in_season',
    coerced: false,
    allowedTransitions: ['playoffs', 'completed'],
  },
  recentActions: [],
}

function mockGet(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function loadLeague(payload: unknown = PAYLOAD) {
  const fetchMock = mockGet(payload)
  render(<LeagueRecoveryClient />)
  fireEvent.change(screen.getByPlaceholderText('league id'), { target: { value: 'lg-1' } })
  fireEvent.click(screen.getByRole('button', { name: /^Load$/ }))
  // Wait on a heading that exists ONLY after a successful load. The league name is split across
  // sibling nodes inside one <p> and also appears as an input placeholder, so matching on it is
  // ambiguous — the first version of this helper timed out for that reason while the component was
  // rendering perfectly well.
  await waitFor(() => expect(screen.getByText(/2\. Lifecycle/)).toBeTruthy())
  return fetchMock
}

describe('LeagueRecoveryClient', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('shows no actions at all until a league is loaded', () => {
    mockGet(PAYLOAD)
    render(<LeagueRecoveryClient />)

    // Nothing destructive can be reached from a cold screen.
    expect(screen.queryByRole('button', { name: /Pause the draft/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Force transition/ })).toBeNull()
  })

  it('keeps "Pause the draft" DISABLED until the league name is typed exactly', async () => {
    await loadLeague()

    const pause = screen.getByRole('button', { name: /Pause the draft/ }) as HTMLButtonElement
    expect(pause.disabled).toBe(true)

    const confirm = screen.getAllByPlaceholderText('Sunday Money')[0]!
    fireEvent.change(confirm, { target: { value: 'Sunday Mone' } })   // one character short
    expect((screen.getByRole('button', { name: /Pause the draft/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(confirm, { target: { value: 'Sunday Money' } })
    expect((screen.getByRole('button', { name: /Pause the draft/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps "Force transition" DISABLED without BOTH a target state and the typed name', async () => {
    await loadLeague()

    const force = () => screen.getByRole('button', { name: /Force transition/ }) as HTMLButtonElement
    expect(force().disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('e.g. pre_draft'), { target: { value: 'setup' } })
    expect(force().disabled).toBe(true)   // state alone is not enough

    // The force confirmation is the SECOND name field on the page (the first belongs to pause).
    const confirms = screen.getAllByPlaceholderText('Sunday Money')
    fireEvent.change(confirms[1]!, { target: { value: 'Sunday Money' } })
    expect(force().disabled).toBe(false)
  })

  it('offers ONLY the server-derived transitions, never the full enum', async () => {
    await loadLeague()

    const options = Array.from(document.querySelectorAll('select option')).map((o) => o.getAttribute('value'))
    expect(options).toEqual(['', 'playoffs', 'completed'])
    // The states that exist but are illegal from here must not be offerable.
    expect(options).not.toContain('archived')
    expect(options).not.toContain('setup')
  })

  it('LABELS a coerced lifecycle state as a fallback instead of stating it as fact', async () => {
    await loadLeague({
      ...PAYLOAD,
      snapshot: { ...PAYLOAD.snapshot, league: { ...PAYLOAD.snapshot.league, name: 'Broken League', lifecycleState: null } },
      lifecycle: { raw: null, normalized: 'in_season', coerced: true, allowedTransitions: ['playoffs'] },
    })

    expect(screen.getByText(/this state is a fallback, not a fact/)).toBeTruthy()
    expect(screen.getByText(/stored value is NULL/)).toBeTruthy()
  })

  it('does NOT show the fallback label when the stored state is genuine', async () => {
    await loadLeague()
    expect(screen.queryByText(/this state is a fallback, not a fact/)).toBeNull()
  })
})
