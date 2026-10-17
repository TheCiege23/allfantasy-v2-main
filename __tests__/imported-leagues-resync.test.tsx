import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ImportedLeaguesPanel } from '@/app/settings/components/sections/ImportedLeaguesPanel'

/*
 * The resync route answers 200 only once the refresh has COMPLETED, so the button says "Synced",
 * never the "Queued" it used to; and a refusal shows the route's own reason instead of "Failed".
 */

const LEAGUE = {
  id: 'L1',
  name: 'Dynasty Degenerates',
  platform: 'sleeper',
  platformLeagueId: 'sl_league_1',
  navigationLeagueId: 'af_1',
  syncStatus: 'error',
  lastSyncedAt: '2026-01-01T00:00:00.000Z',
}

function mockFetch(resync: { status: number; body: Record<string, unknown> }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/api/league/list')) return new Response(JSON.stringify({ leagues: [LEAGUE] }), { status: 200 })
      if (url.includes('/api/leagues/import/resync')) return new Response(JSON.stringify(resync.body), { status: resync.status })
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}

async function clickResync() {
  render(<ImportedLeaguesPanel />)
  fireEvent.click(await screen.findByRole('button', { name: /resync/i }))
}

afterEach(() => vi.unstubAllGlobals())

describe('ImportedLeaguesPanel resync', () => {
  it('says Synced (not Queued) and freshens the row when the refresh completed', async () => {
    mockFetch({ status: 200, body: { ok: true } })
    await clickResync()
    expect(await screen.findByRole('button', { name: /synced/i })).toBeTruthy()
    expect(screen.queryByText(/queued/i)).toBeNull()
    expect(screen.getByText('just now')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('says "Already syncing" when another refresh holds the lock', async () => {
    mockFetch({ status: 409, body: { ok: false, error: 'This league is already being refreshed. Try again shortly.' } })
    await clickResync()
    expect(await screen.findByRole('button', { name: /already syncing/i })).toBeTruthy()
  })

  it("shows the route's reason when the refresh did not complete", async () => {
    const error = 'The existing league data was preserved, but the refresh did not complete. Please try again shortly.'
    mockFetch({ status: 503, body: { ok: false, error } })
    await clickResync()
    expect((await screen.findByTestId('resync-error-L1')).textContent).toBe(error)
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
    expect(screen.queryByText('just now')).toBeNull()
  })
})
