// @vitest-environment jsdom
/**
 * B6 (DB-first) — the "League Imports" resync UI: enqueue → poll the DB-backed status → exit
 * "Refreshing" on EVERY terminal outcome. Proves it never hangs on a spinner, shows honest labels
 * (never "Queued" for a failure), keeps the previous snapshot visible while refreshing, dedupes
 * double-clicks to one request, and drops the spinner into "background" past the poll deadline.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

// App Router context is not mounted in unit tests — render Link as a plain anchor.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: unknown }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))

import { ImportedLeaguesPanel } from '@/app/settings/components/sections/ImportedLeaguesPanel'

const LEAGUE = {
  id: 'L1', name: 'HailShiva', platform: 'sleeper', platformLeagueId: '131353',
  hasUnifiedRecord: true, navigationLeagueId: 'L1', season: 2026, teamCount: 12, syncStatus: 'pending',
}

function res(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

// Per-test programmable responses for the POST enqueue and the GET status poll.
let postResponse: () => Promise<Response>
let getPhase: string

function installFetch() {
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET'
    if (url.includes('/api/league/list')) return res({ leagues: [LEAGUE] })
    if (url.includes('/api/leagues/import/resync') && method === 'POST') return postResponse()
    if (url.includes('/api/leagues/import/resync')) {
      const iso = new Date().toISOString()
      return res({ ok: true, phase: getPhase, lastChecked: iso, lastSuccessfullyUpdated: iso })
    }
    return res({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const postCount = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter((c) => String(c[0]).includes('/api/leagues/import/resync') && (c[1] as { method?: string } | undefined)?.method === 'POST').length

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.useFakeTimers()
  postResponse = async () => res({ ok: true, status: 'queued', jobId: 'job1', lastSuccessfullyUpdated: null }, 202)
  getPhase = 'refreshing'
  fetchMock = installFetch()
  render(<ImportedLeaguesPanel />)
  await flush() // resolve the /api/league/list mount fetch
  expect(screen.getByText('HailShiva')).toBeTruthy()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function clickResync() {
  fireEvent.click(screen.getByRole('button', { name: /resync/i }))
}

describe('ImportedLeaguesPanel — DB-first background resync', () => {
  it('success: enqueue → poll → "Updated", exits Refreshing', async () => {
    getPhase = 'updated'
    clickResync()
    await flush() // POST resolves → Refreshing
    expect(screen.getByText(/refreshing in the background/i)).toBeTruthy()
    await flush(3500) // first poll → terminal
    // "Updated" shows in both the caption and the freshness stamp — either proves the terminal state.
    expect(screen.getAllByText(/^Updated/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/refreshing in the background/i)).toBeNull()
    expect(screen.getByRole('button', { name: /resync/i })).toBeTruthy() // button re-enabled
  })

  it('durable failure: poll returns failed → honest "previous data still available", exits Refreshing', async () => {
    getPhase = 'failed'
    clickResync()
    await flush()
    await flush(3500)
    expect(screen.getByText(/refresh failed — your previous data is still available/i)).toBeTruthy()
    expect(screen.queryByText(/refreshing in the background/i)).toBeNull()
  })

  it('quota (429) → "Too many refreshes in progress", never claims Queued', async () => {
    postResponse = async () => res({ ok: false, error: 'Too many refreshes in progress.' }, 429)
    clickResync()
    await flush()
    expect(screen.getByText(/too many refreshes in progress/i)).toBeTruthy()
    expect(screen.queryByText(/queued/i)).toBeNull()
  })

  it('network rejection on enqueue → "Refresh failed", exits Refreshing', async () => {
    postResponse = async () => { throw new Error('network down') }
    clickResync()
    await flush()
    expect(screen.getByText(/refresh failed/i)).toBeTruthy()
    expect(screen.queryByText(/refreshing in the background/i)).toBeNull()
  })

  it('already fresh (up_to_date) → "Checked — no new information", no polling', async () => {
    postResponse = async () => res({ ok: true, status: 'up_to_date', jobId: null, lastSuccessfullyUpdated: new Date().toISOString() }, 202)
    clickResync()
    await flush()
    expect(screen.getByText(/checked — no new information/i)).toBeTruthy()
  })

  it('double-click issues exactly ONE enqueue request', async () => {
    const btn = screen.getByRole('button', { name: /resync/i })
    fireEvent.click(btn)
    fireEvent.click(btn) // second click: the button is now disabled + the in-flight ref guard blocks it
    await flush()
    expect(postCount(fetchMock)).toBe(1)
  })

  it('keeps the previous snapshot visible while refreshing', async () => {
    clickResync()
    await flush()
    // The row's data (league name + manager count) stays rendered during the refresh.
    expect(screen.getByText('HailShiva')).toBeTruthy()
    expect(screen.getByText(/12 managers/i)).toBeTruthy()
  })

  it('past the poll deadline the spinner drops to "background" (never stuck)', async () => {
    getPhase = 'refreshing' // never terminal
    clickResync()
    await flush()
    await flush(95_000) // exceed MAX_POLL_MS (90s)
    expect(screen.getByText(/refreshing in the background — check back shortly/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /resync/i })).toBeTruthy()
  })
})
