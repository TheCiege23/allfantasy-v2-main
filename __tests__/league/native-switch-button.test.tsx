/**
 * Step 7 of docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md: the "Switch to AllFantasy" card runs the in-place
 * switch, and the retired copy flow (/create-league?fromLeague=) sends old links to that card instead of copying.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { NativeReadinessReport } from '@/lib/league/nativeReadiness'

const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`) })
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url), notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: vi.fn(async () => []) } } }))
vi.mock('@/app/create-league/CreateLeaguePageClient', () => ({ CreateLeaguePageClient: () => null }))

import { NativeReadinessCard } from '@/components/league-home/NativeReadinessCard'

const READY: NativeReadinessReport = {
  leagueId: 'L1', status: 'ready', platformLabel: 'Sleeper', sport: 'NFL', teamCount: 12, playerCount: 200,
  checkedAt: new Date().toISOString(), items: [],
}

let fetchMock: ReturnType<typeof vi.fn>
const reload = vi.fn()

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'location', { value: { ...window.location, reload, hash: '' }, configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: async () => body })

describe('the Switch to AllFantasy card', () => {
  it('asks first, then switches the league in place and reloads', async () => {
    fetchMock.mockImplementationOnce(() => json(200, READY)).mockImplementationOnce(() => json(200, { kind: 'converted' }))
    render(<NativeReadinessCard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('native-switch-start'))
    expect(screen.getByTestId('native-switch-confirm').textContent).toContain('stops syncing from Sleeper')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('native-switch-confirm-button'))
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/leagues/L1/convert-to-native', expect.objectContaining({ method: 'POST', body: JSON.stringify({ acceptWeeklyLineups: false }) }))
  })

  it('a baseball league must accept weekly lineups before it can switch', async () => {
    fetchMock.mockImplementationOnce(() => json(200, { ...READY, sport: 'MLB', platformLabel: 'ESPN' })).mockImplementationOnce(() => json(200, { kind: 'converted' }))
    render(<NativeReadinessCard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('native-switch-start'))
    const go = screen.getByTestId('native-switch-confirm-button') as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ body: JSON.stringify({ acceptWeeklyLineups: true }) })
  })

  it('shows what stops it when the league changed since the check, and writes nothing', async () => {
    fetchMock.mockImplementationOnce(() => json(200, READY)).mockImplementationOnce(() => json(409, {
      error: '1 thing needs fixing', blockers: [{ code: 'provider_draft_live', severity: 'blocker', title: 'A Sleeper draft is running', action: 'Wait until it ends.' }],
    }))
    render(<NativeReadinessCard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('native-switch-start'))
    fireEvent.click(screen.getByTestId('native-switch-confirm-button'))
    expect(await screen.findByTestId('native-readiness-item-provider_draft_live')).toBeTruthy()
    expect(screen.queryByTestId('native-switch-start')).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })

  it('offers no switch while something blocks it', async () => {
    fetchMock.mockImplementationOnce(() => json(200, { ...READY, status: 'blocked', items: [{ code: 'season_in_progress', severity: 'blocker', title: 'The season is still being played', action: 'Switch in the offseason.' }] }))
    render(<NativeReadinessCard leagueId="L1" />)
    expect(await screen.findByTestId('native-readiness-item-season_in_progress')).toBeTruthy()
    expect(screen.queryByTestId('native-switch-start')).toBeNull()
  })
})

describe('the retired copy flow', () => {
  it('sends an old /create-league?fromLeague= link to the league’s switch card instead of copying it', async () => {
    const { default: CreateLeaguePage } = await import('@/app/create-league/page')
    await expect(CreateLeaguePage({ searchParams: Promise.resolve({ fromLeague: 'imp-1' }) })).rejects.toThrow('REDIRECT /league/imp-1?view=commissioner#native-switch')
  })

  it('still opens the create wizard without it', async () => {
    const { default: CreateLeaguePage } = await import('@/app/create-league/page')
    await expect(CreateLeaguePage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
