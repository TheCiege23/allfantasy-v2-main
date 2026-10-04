import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveScores } from '@/components/core-app/screens/LiveScores'
import { LiveScoresClient } from '@/components/live/LiveScoresClient'
import type { LivePageData } from '@/lib/live/liveScoresPage'

const payload = (sport = 'NFL'): LivePageData => ({
  sport, scope: 'all', games: [], counts: [{ sport: 'NFL', label: 'NFL', slateCount: 0 }, { sport: 'NBA', label: 'NBA', slateCount: 0 }],
  impact: { totalPoints: 0, livePlayers: 0, liveGames: 0, biggestMover: null, plays: [], upNext: [] },
  lockAlerts: [], fetchedAt: new Date().toISOString(), hasRosterData: false, loadFailed: false,
})
const response = (status: number, sport = 'NBA') => ({ status, ok: status === 200, headers: new Headers(), json: async () => payload(sport) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe.each([['core', LiveScores], ['public', LiveScoresClient]] as const)('%s live polling', (_label, Client) => {
  it.each(['http', 'network'] as const)('ignores an old %s failure after a newer view succeeds', async (failure) => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    let reject!: (error: Error) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no })).mockResolvedValue(response(200))
    vi.stubGlobal('fetch', fetcher)
    render(_label === 'core' ? <LiveScores data={payload()} /> : <LiveScoresClient initial={payload()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    fireEvent.click(screen.getByRole('tab', { name: /NBA/ }))
    await act(async () => {})
    await act(async () => { if (failure === 'http') resolve(response(503)); else reject(new Error('old request failed')) })
    expect(screen.queryByText('Reconnecting')).toBeNull()
  })

  it('does not let an old 304 clear the current view failure', async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise(yes => { resolve = yes })).mockResolvedValue(response(503)))
    render(_label === 'core' ? <LiveScores data={payload()} /> : <LiveScoresClient initial={payload()} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    fireEvent.click(screen.getByRole('tab', { name: /NBA/ }))
    await act(async () => {})
    expect(screen.getByText('Reconnecting')).toBeInTheDocument()
    await act(async () => { resolve(response(304)) })
    expect(screen.getByText('Reconnecting')).toBeInTheDocument()
  })
})
