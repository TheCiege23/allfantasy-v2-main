import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { GROUNDING_STALE_MS, groundingFreshness } from '@/lib/chimmy/groundingFreshness'
import { ChimmyGroundingLine } from '@/components/core-app/comms/ChimmyGroundingLine'

/*
 * The footer under a grounded Chimmy answer (2026-09-28). It printed "synced 9/28/2026, 6:30:26 PM"
 * — a timestamp to subtract in your head, with nothing to say whether it was old enough to matter.
 */
const NOW = Date.parse('2026-09-28T22:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('groundingFreshness', () => {
  it('reads as relative time, and turns stale at three hours', () => {
    expect(groundingFreshness(ago(20_000), NOW)).toEqual({ label: 'synced just now', stale: false })
    expect(groundingFreshness(ago(12 * 60_000), NOW)).toEqual({ label: 'synced 12 min ago', stale: false })
    expect(groundingFreshness(ago(GROUNDING_STALE_MS - 60_000), NOW)).toEqual({ label: 'synced 2 hr ago', stale: false })
    expect(groundingFreshness(ago(GROUNDING_STALE_MS), NOW)).toEqual({ label: 'synced 3 hr ago', stale: true })
    expect(groundingFreshness(ago(3 * 24 * 3_600_000), NOW)).toEqual({ label: 'synced 3 days ago', stale: true })
  })

  it('never synced, an unreadable time, or a clock ahead of the server', () => {
    expect(groundingFreshness(null, NOW)).toEqual({ label: 'never synced', stale: true })
    expect(groundingFreshness('not a date', NOW)).toEqual({ label: 'sync time unknown', stale: true })
    expect(groundingFreshness(new Date(NOW + 120_000).toISOString(), NOW).label).toBe('synced just now')
  })
})

describe('ChimmyGroundingLine', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const line = (lastSyncedAt: string | null, offerRefresh = true, leagueId: string | null = 'af-1') =>
    render(<ChimmyGroundingLine leagueId={leagueId} leagueName="Chop Shop" lastSyncedAt={lastSyncedAt} offerRefresh={offerRefresh} />)

  it('fresh data: relative time, no warning, no refresh', () => {
    const { container } = line(ago(12 * 60_000))
    const p = container.querySelector('.af-cm-grounding')!
    expect(p.textContent).toContain('Read from Chop Shop · synced 12 min ago')
    expect(p.getAttribute('data-stale')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('stale data on the newest answer offers a one-league refresh, and never re-asks', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ refreshed: 1, busy: 0 }) })
    const { container } = line(ago(5 * 3_600_000))
    expect(container.querySelector('.af-cm-grounding')!.getAttribute('data-stale')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh league data' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('refreshed — ask again to use the new data'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/core/players/refresh-lineups')
    expect(JSON.parse(init.body)).toEqual({ leagueId: 'af-1' })
    expect(container.querySelector('.af-cm-grounding')!.getAttribute('data-stale')).toBeNull()
  })

  it('says so when a refresh is already running or fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
    line(ago(5 * 3_600_000))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh league data' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('already running'))
  })

  it('an older answer, or one with no league id, offers no refresh', () => {
    line(ago(5 * 3_600_000), false)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('no league id: no refresh either', () => {
    line(ago(5 * 3_600_000), true, null)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
