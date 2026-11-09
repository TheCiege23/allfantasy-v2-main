/**
 * The tournament league controls say when they fail to load (2026-11-09, tournament gaps audit item 2). The control
 * dashboard (the commissioner's Leagues tab and /tournament/[id]/control) rendered "Loading…" whenever it had no
 * data — so after any failed request (401, 403, 404, 500) it showed a spinner forever, with no error and no retry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TournamentControlDashboard } from '@/components/tournament/TournamentControlDashboard'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('@/hooks/useUserTimezone', () => ({ useUserTimezone: () => ({ formatInTimezone: (d: unknown) => String(d), timezone: 'UTC' }) }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Tournament league controls, failed load', () => {
  it('shows the server error and a retry, not an endless "Loading…"', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Commissioner access required' }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<TournamentControlDashboard tournamentId="t1" hideLocalBackLink />)
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert.textContent).toContain('Commissioner access required')
    expect(screen.queryByText('Loading…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('falls back to a plain message when the response has no error text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json') } })))
    render(<TournamentControlDashboard tournamentId="t1" hideLocalBackLink />)
    expect((await screen.findByRole('alert', {}, { timeout: 3000 })).textContent).toContain('could not be loaded')
  })
})
