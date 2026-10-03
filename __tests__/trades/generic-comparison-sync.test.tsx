// @vitest-environment jsdom
import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TradeComparisonSnapshots } from '@/components/core-app/screens/TradeComparisonSnapshots'

const fetchMock = vi.fn()
const snapshot = {
  id: 'device-1', scope: 'generic:user-1', sport: 'NFL', title: 'Team A ↔ Team B',
  at: '2026-10-03T10:00:00.000Z', basis: 'General market values', uncertainty: 'Market estimate',
  sides: ['Team A', 'Team B'] as [string, string],
  assets: [['Player One'], ['Player Two']] as [string[], string[]],
  grades: ['B', 'D'] as [string, string], verdict: 'Favors Team A',
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('generic comparison account sync', () => {
  it('imports an existing device save once and clears it only after the account accepts it', async () => {
    window.localStorage.setItem('af-trade-comparisons:v1', JSON.stringify([snapshot]))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ snapshots: [] }) })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ snapshots: [snapshot] }) })
    render(<TradeComparisonSnapshots scope="generic:user-1" snapshot={null} />)
    expect(await screen.findByText('Saved comparisons (1)')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).snapshots[0]).toMatchObject({ id: 'device-1', sport: 'NFL' })
    await waitFor(() => expect(window.localStorage.getItem('af-trade-comparisons:v1')).toBe('[]'))
  })

  it('keeps the device save available when account sync fails', async () => {
    window.localStorage.setItem('af-trade-comparisons:v1', JSON.stringify([snapshot]))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ snapshots: [] }) })
    fetchMock.mockResolvedValueOnce({ ok: false })
    render(<TradeComparisonSnapshots scope="generic:user-1" snapshot={null} />)
    expect(await screen.findByText(/device saves could not sync/)).toBeTruthy()
    expect(screen.getByText('Saved comparisons (1)')).toBeTruthy()
    expect(window.localStorage.getItem('af-trade-comparisons:v1')).toContain('device-1')
    expect(screen.getByRole('button', { name: 'Save this comparison' })).toHaveProperty('disabled', true)
  })
})
