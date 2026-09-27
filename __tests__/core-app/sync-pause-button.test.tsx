import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => h }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => <button>Sync now</button> }))
import SyncPauseButton from '@/components/core-app/SyncPauseButton'
import { LeagueSync } from '@/components/core-app/screens/LeagueSync'
beforeEach(() => { h.refresh.mockReset() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('sync pause control', () => {
  it('pauses and resumes only the rendered league and confirms the saved state', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, paused: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, paused: false }) })
    vi.stubGlobal('fetch', post)
    render(<SyncPauseButton leagueId="my-league" paused={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause account sync' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume account sync' })).toBeTruthy())
    expect(JSON.parse(post.mock.calls[0][1].body)).toEqual({ leagueId: 'my-league', paused: true })
    fireEvent.click(screen.getByRole('button', { name: 'Resume account sync' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause account sync' })).toBeTruthy())
    expect(JSON.parse(post.mock.calls[1][1].body)).toEqual({ leagueId: 'my-league', paused: false })
    expect(h.refresh).toHaveBeenCalledTimes(2)
  })
  it('keeps the original state and shows an error when saving fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Try again later.' }) })))
    render(<SyncPauseButton leagueId="my-league" paused={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause account sync' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later.')
    expect(screen.getByRole('button', { name: 'Pause account sync' })).toBeEnabled()
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('shows paused status and preserved historical error without prompting a reconnect', () => {
    render(<LeagueSync manageHref="/import" data={{ available: true, league: { id: 'inactive', name: 'NFL Dynasty', platform: 'sleeper' },
      syncKey: 'sleeper:123', syncPaused: true, status: 'paused', connectedSince: null, lastReadAt: null,
      seasonsOnFile: { available: false, reason: 'No history' }, lastAttemptedAt: null, consecutiveFailures: 3,
      lastError: 'League not found', rows: [], coarse: false, orphanedRun: null }} />)
    expect(screen.getByText('Account sync paused')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume account sync' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Reconnect this platform' })).toBeNull()
    expect(screen.getByText('Latest recorded sync error')).toBeTruthy()
    expect(screen.getByText('League not found')).toBeTruthy()
  })
})
