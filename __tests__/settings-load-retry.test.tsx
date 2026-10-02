import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LegacyRankSettingsSection } from '@/app/settings/components/sections/LegacyRankSettingsSection'
import { ImportedLeaguesPanel } from '@/app/settings/components/sections/ImportedLeaguesPanel'

/*
 * A failed load on the Legacy and League Imports tabs used to end at "Refresh the page to try
 * again". Each card now has its own Try again, which refetches only that card.
 */

/** Answers each URL with its queued responses in order; a 500 is a failed load. */
function scriptedFetch(script: Record<string, Array<{ status: number; body?: unknown }>>) {
  const calls: Record<string, number> = {}
  const fn = vi.fn(async (url: string) => {
    const key = Object.keys(script).find((k) => url.includes(k))
    if (!key) throw new Error(`unexpected fetch ${url}`)
    const i = calls[key] ?? 0
    calls[key] = i + 1
    const step = script[key]![Math.min(i, script[key]!.length - 1)]!
    return new Response(JSON.stringify(step.body ?? {}), { status: step.status })
  })
  vi.stubGlobal('fetch', fn)
  return { calls }
}

afterEach(() => vi.unstubAllGlobals())

describe('Legacy tab retry', () => {
  it('retries a failed rank load without refetching achievements', async () => {
    const { calls } = scriptedFetch({
      '/api/user/rank': [{ status: 500 }, { status: 200, body: { level: 7, tier: 'Gold', xpTotal: 1200 } }],
      '/api/achievements': [{ status: 200, body: { achievements: [] } }],
    })
    render(<LegacyRankSettingsSection />)
    fireEvent.click(await screen.findByTestId('legacy-rank-retry'))
    expect(await screen.findByText(/1,?200/)).toBeTruthy()
    expect(screen.queryByTestId('legacy-rank-retry')).toBeNull()
    expect(calls['/api/user/rank']).toBe(2)
    expect(calls['/api/achievements']).toBe(1)
  })

  it('retries failed achievements', async () => {
    scriptedFetch({
      '/api/user/rank': [{ status: 200, body: {} }],
      '/api/achievements': [{ status: 500 }, { status: 200, body: { achievements: [{ id: 'a1', name: 'First Title', earned: true }] } }],
    })
    render(<LegacyRankSettingsSection />)
    fireEvent.click(await screen.findByTestId('legacy-achievements-retry'))
    expect(await screen.findByText('First Title')).toBeTruthy()
  })
})

describe('League Imports retry', () => {
  it('retries a failed league list instead of claiming there are no leagues', async () => {
    scriptedFetch({
      '/api/league/list': [
        { status: 500 },
        { status: 200, body: { leagues: [{ id: 'L1', name: 'Dynasty Degenerates', platform: 'sleeper' }] } },
      ],
    })
    render(<ImportedLeaguesPanel />)
    const retry = await screen.findByTestId('imported-leagues-retry')
    expect(screen.queryByText(/No leagues imported yet/)).toBeNull()
    fireEvent.click(retry)
    expect(await screen.findByText('Dynasty Degenerates')).toBeTruthy()
  })
})
