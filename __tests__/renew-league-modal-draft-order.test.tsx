import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Renewing a redraft league also creates its next draft. The commissioner picks the order in the
 * renew modal — and for `manual`, sets it with an ordered list — and the POST carries exactly that.
 */

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { RenewLeagueModal, moveDraftTeam } from '@/components/league-settings/RenewLeagueModal'

const getPayload = {
  currentSeason: 2026,
  nextSeason: 2027,
  leagueType: 'redraft',
  members: [],
  orphanMembers: [],
  renewalCompleted: false,
  draftTeams: [
    { rosterId: 'R-a', displayName: 'Alpha' },
    { rosterId: 'R-b', displayName: 'Bravo' },
    { rosterId: 'R-c', displayName: 'Charlie' },
  ],
  defaultDraftOrder: 'standings',
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? { ok: true, json: async () => ({ ok: true, nextSeason: 2027, orphanCount: 0, dispersalDraftEligible: false, listedInFinder: false, draft: null }) }
      : { ok: true, json: async () => getPayload },
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openToConfirmStep() {
  render(<RenewLeagueModal leagueId="L1" isOpen onClose={() => {}} />)
  await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull())
  const next = () => {
    const buttons = screen.getAllByRole('button')
    const btn = buttons.find((b) => b.className.includes('ml-auto'))!
    fireEvent.click(btn)
  }
  next()
  next()
  return screen.getByTestId('renew-draft-order')
}

function postedBody() {
  const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  return JSON.parse(String((call![1] as RequestInit).body))
}

describe('moveDraftTeam', () => {
  it('swaps with the neighbour and ignores out-of-range moves', () => {
    expect(moveDraftTeam(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveDraftTeam(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveDraftTeam(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('RenewLeagueModal draft order', () => {
  it('defaults to the saved method and sends it with the renew', async () => {
    await openToConfirmStep()
    expect((screen.getByLabelText(/2027 draft order/i) as HTMLSelectElement).value).toBe('standings')
    fireEvent.click(screen.getByText(/confirm|renew/i, { selector: 'button.ml-auto' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(true))
    expect(postedBody()).toMatchObject({ draftOrder: 'standings' })
    expect(postedBody().manualOrder).toBeUndefined()
  })

  it('manual: the ordered list is reorderable and is what gets posted', async () => {
    await openToConfirmStep()
    fireEvent.change(screen.getByLabelText(/2027 draft order/i), { target: { value: 'manual' } })
    // Charlie up twice → first.
    fireEvent.click(screen.getByLabelText('Move Charlie up'))
    fireEvent.click(screen.getByLabelText('Move Charlie up'))
    const items = screen.getByLabelText('Manual draft order').querySelectorAll('li')
    expect([...items].map((li) => li.textContent)).toEqual(['1Charlie', '2Alpha', '3Bravo'])
    fireEvent.click(screen.getByText(/confirm|renew/i, { selector: 'button.ml-auto' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(true))
    expect(postedBody()).toMatchObject({ draftOrder: 'manual', manualOrder: ['R-c', 'R-a', 'R-b'] })
  })

  it('a non-redraft renew shows no picker and sends no order', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? { ok: true, json: async () => ({ ok: true, nextSeason: 2027, orphanCount: 0, dispersalDraftEligible: false, listedInFinder: false }) }
        : { ok: true, json: async () => ({ ...getPayload, leagueType: 'dynasty' }) },
    )
    render(<RenewLeagueModal leagueId="L1" isOpen onClose={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull())
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getAllByRole('button').find((b) => b.className.includes('ml-auto'))!)
    expect(screen.queryByTestId('renew-draft-order')).toBeNull()
    fireEvent.click(screen.getByText(/confirm|renew/i, { selector: 'button.ml-auto' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(true))
    expect(postedBody().draftOrder).toBeUndefined()
  })
})
