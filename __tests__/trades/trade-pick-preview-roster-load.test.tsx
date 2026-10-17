// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import React from 'react'
import { useLeagueRosters } from '@/components/core-app/screens/useLeagueRosters'
import { readPickPreviewValue } from '@/lib/trade-value-console/pickPreview'

function Quote({ leagueId, viewerId = 'account-a' }: { leagueId: string; viewerId?: string }) {
  const { data, state } = useLeagueRosters(leagueId, true, viewerId)
  const price = readPickPreviewValue({ leagueId, book: data?.pickPreviewBook, year: 2027, round: 2 })
  return <output data-testid="quote">{price ?? state}</output>
}
const response = (leagueId: string, value: number) => ({ ok: true,
  json: async () => ({ rosters: [], pickPreviewBook: { leagueId, values: { '2027:2': value } } }) })
afterEach(() => vi.unstubAllGlobals())

describe('loading a league pick quote', () => {
  it('ignores a late old-league response and loads the new league quote', async () => {
    const pending: Array<(value: unknown) => void> = []
    const fetch = vi.fn(() => new Promise(resolve => pending.push(resolve)))
    vi.stubGlobal('fetch', fetch)
    const view = render(<Quote leagueId="L1" />)
    view.rerender(<Quote leagueId="L2" />)
    expect(fetch).toHaveBeenCalledTimes(2)
    await act(async () => pending[0](response('L1', 1585)))
    expect(screen.getByTestId('quote').textContent).toBe('loading')
    await act(async () => pending[1](response('L2', 1700)))
    expect(screen.getByTestId('quote').textContent).toBe('1700')
  })
  it('clears and reloads quotes when the signed-in account changes', async () => {
    const pending: Array<(value: unknown) => void> = []
    const fetch = vi.fn(() => new Promise(resolve => pending.push(resolve)))
    vi.stubGlobal('fetch', fetch)
    const view = render(<Quote leagueId="L1" viewerId="account-a" />)
    await act(async () => pending[0](response('L1', 1585)))
    view.rerender(<Quote leagueId="L1" viewerId="account-b" />)
    expect(screen.getByTestId('quote').textContent).toBe('loading')
    await act(async () => pending[1](response('L1', 1600)))
    expect(screen.getByTestId('quote').textContent).toBe('1600')
  })
  it('reports a failed read once without a repeated request loop', async () => {
    const fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Unavailable' }) }))
    vi.stubGlobal('fetch', fetch)
    await act(async () => render(<Quote leagueId="L1" />))
    expect(screen.getByTestId('quote').textContent).toBe('failed')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
