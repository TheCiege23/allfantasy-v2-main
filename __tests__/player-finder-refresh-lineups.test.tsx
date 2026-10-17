import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { asOfLabel, RefreshLineups } from '@/components/core-app/player-finder/RefreshLineups'

/*
 * "Lineups as of 11:52a ET · Refresh my lineups" on the game-day list. The stamp is the OLDEST
 * roster read; the button loops the batch endpoint until nothing remains, then reloads.
 */
const NOW = '2026-09-27T16:40:00.000Z' // Sun 12:40p ET

describe('asOfLabel', () => {
  it('names the Eastern clock and how long ago', () => {
    expect(asOfLabel('2026-09-27T14:40:00.000Z', NOW)).toBe('Lineups as of 10:40a ET · 2h 0m ago')
    expect(asOfLabel('2026-09-27T16:28:00.000Z', NOW)).toBe('Lineups as of 12:28p ET · 12 min ago')
    expect(asOfLabel('2026-09-27T16:40:10.000Z', NOW)).toBe('Lineups as of 12:40p ET · just now')
  })
  it('drops the clock once it is more than a day old, and is null for nothing', () => {
    expect(asOfLabel('2026-09-24T16:40:00.000Z', NOW)).toBe('Lineups as of 3d ago')
    expect(asOfLabel(null, NOW)).toBeNull()
    expect(asOfLabel('garbage', NOW)).toBeNull()
  })
})

describe('RefreshLineups', () => {
  const reload = vi.fn()
  const realLocation = window.location
  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    reload.mockReset()
  })

  it('posts batches until nothing remains, then reloads the list', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
    const batches = [
      { total: 12, remaining: 5, refreshed: 7, busy: 0, skipped: 0, failed: 0 },
      { total: 12, remaining: 0, refreshed: 5, busy: 0, skipped: 0, failed: 0 },
    ]
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => batches.shift() }))
    vi.stubGlobal('fetch', fetchMock)

    render(<RefreshLineups asOf="2026-09-27T14:40:00.000Z" nowIso={NOW} />)
    expect(screen.getByText('Lineups as of 10:40a ET · 2h 0m ago')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh my lineups' }))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]).toEqual(['/api/core/players/refresh-lineups', { method: 'POST' }])
  })

  it('says so when the refresh cannot run, and does not reload over it', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    render(<RefreshLineups asOf={null} nowIso={NOW} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh my lineups' }))
    expect(await screen.findByText(/Could not refresh right now/)).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })
})
