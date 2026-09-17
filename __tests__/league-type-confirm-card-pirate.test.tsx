import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LeagueTypeConfirm from '@/components/league/LeagueTypeConfirm'

/*
 * The league-home / settings format card (components/league/LeagueTypeConfirm.tsx).
 *
 * ⚠ IT USED TO CARRY ITS OWN SIX OPTIONS. Switched to the shared list on
 * 2026-09-16 so a league confirmed as Pirate in the /core header is not
 * re-saved here without the base the API requires.
 */

type Call = { method: string; body: unknown }
let calls: Call[] = []

function stubFetch(state: Record<string, unknown>) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ method, body })
      return Promise.resolve(new Response(JSON.stringify(state), { status: 200 }))
    }),
  )
}

const baseState = {
  leagueId: 'L1',
  leagueName: 'Seven Seas',
  storedType: 'redraft',
  suggestion: { suggested: 'redraft', confidence: 'low', reasons: [], detectedBuyIn: null, looksNonCompetitive: false },
  confirmation: null,
  rankableType: null,
  canConfirm: true,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LeagueTypeConfirm — shared options and the Pirate follow-up', () => {
  it('offers every shared concept, Pirate and EFL included', async () => {
    stubFetch(baseState)
    render(<LeagueTypeConfirm leagueId="L1" alwaysShow />)
    expect(await screen.findByRole('radio', { name: /Pirate/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /EFL/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Devy/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Survivor Guillotine/ })).toBeInTheDocument()
  })

  it('saves Survivor Guillotine as one type, with no base', async () => {
    stubFetch(baseState)
    render(<LeagueTypeConfirm leagueId="L1" alwaysShow />)
    fireEvent.click(await screen.findByRole('radio', { name: /^Survivor Guillotine/ }))
    expect(screen.queryByRole('radiogroup', { name: 'Do rosters carry over?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm format' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ type: 'survivor_guillotine', buyIn: null })
  })

  it('holds the save until a Pirate league says whether rosters carry over, then sends both', async () => {
    stubFetch(baseState)
    render(<LeagueTypeConfirm leagueId="L1" alwaysShow />)
    fireEvent.click(await screen.findByRole('radio', { name: /Pirate/ }))

    const save = screen.getByRole('button', { name: 'Confirm format' })
    expect(save).toBeDisabled()
    expect(screen.getByRole('radiogroup', { name: 'Do rosters carry over?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Redraft' }))
    expect(save).not.toBeDisabled()
    fireEvent.click(save)

    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      type: 'pirate',
      buyIn: null,
      baseFormat: 'redraft',
    })
  })

  it('sends no base for any other type', async () => {
    stubFetch(baseState)
    render(<LeagueTypeConfirm leagueId="L1" alwaysShow />)
    fireEvent.click(await screen.findByRole('radio', { name: /EFL/ }))
    expect(screen.queryByRole('radiogroup', { name: 'Do rosters carry over?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm format' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ type: 'efl', buyIn: null })
  })

  it('prefills a saved Pirate answer so re-saving keeps it', async () => {
    stubFetch({
      ...baseState,
      storedType: 'pirate',
      confirmation: { type: 'pirate', confirmedAt: '2026-09-16T00:00:00Z', buyIn: null, baseFormat: 'dynasty' },
      rankableType: 'pirate',
    })
    render(<LeagueTypeConfirm leagueId="L1" alwaysShow />)
    expect(await screen.findByText('Pirate · Dynasty')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dynasty' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Update format' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ type: 'pirate', baseFormat: 'dynasty' })
  })
})
