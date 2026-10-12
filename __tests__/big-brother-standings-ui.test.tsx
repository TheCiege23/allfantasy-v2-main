import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BigBrotherStandings } from '@/components/big-brother/BigBrotherStandings'
import { StandingsTab } from '@/app/league/[leagueId]/tabs/StandingsTab'
import { buildBigBrotherStandings } from '@/lib/big-brother/standings'
vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
const data = () => buildBigBrotherStandings({
  leagueId: 'l', season: 2026, rosters: ['a', 'b', 'c', 'd'].map(id => ({ id, teamName: `Team ${id}` })),
  cycles: [{ week: 1, phase: 'EVICTION_RESOLVED', hohRosterId: 'a', vetoWinnerRosterId: 'c', nominee1RosterId: 'b', nominee2RosterId: 'd',
    vetoUsed: false, vetoSavedRosterId: null, replacementNomineeRosterId: null, evictedRosterId: 'b', closedAt: '2026-09-10' }],
  juryRosterIds: ['b'], finaleSize: 2, winnerRosterId: null, viewerRosterId: 'c', scores: [{ rosterId: 'a', week: 1, totalPoints: 0 }],
})
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => data() }); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Big Brother standings manager experience', () => {
  it('routes the variant to real standings with accessible team rows, score coverage and game navigation', async () => {
    render(<StandingsTab league={{ id: 'l', name: 'Blah', sport: 'NFL', platform: 'allfantasy', format: 'redraft', teamCount: 4, leagueVariant: 'big_brother' }} />)
    await screen.findByRole('heading', { name: 'House standings' })
    expect(screen.queryByText(/coming soon/i)).toBeNull()
    const region = screen.getByRole('region', { name: 'Big Brother season standings' })
    expect(region.getAttribute('tabindex')).toBe('0')
    const team = within(region).getByRole('rowheader', { name: /Team c/ })
    expect(team.textContent).toContain('You')
    expect(region.querySelector('tr[data-viewer]')?.textContent).toContain('Team c')
    expect(within(region).getByText('0.00')).toBeTruthy()
    expect(within(region).getAllByText('\u2014').length).toBeGreaterThan(0)
    expect(screen.getByText('2026 \u00b7 Big Brother')).toBeTruthy()
    expect(within(region).getByText('1 scored week')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Jury center' }).getAttribute('href')).toBe('/league/l?tab=bb_jury')
    expect(screen.getByRole('region', { name: 'Weekly Big Brother results' })).toBeTruthy()
  })
  it('filters by jury and team name without altering recorded finishes', async () => {
    render(<BigBrotherStandings leagueId="l" />)
    await screen.findByRole('heading', { name: 'House standings' })
    fireEvent.change(screen.getByLabelText('House status'), { target: { value: 'jury' } })
    const region = screen.getByRole('region', { name: 'Big Brother season standings' })
    expect(within(region).getAllByRole('rowheader').map(r => r.textContent)).toEqual(['Team b'])
    expect(within(region).getByRole('cell', { name: '4' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Find a team'), { target: { value: 'unknown' } })
    expect(screen.getByText('No teams match these filters.')).toBeTruthy()
    expect(screen.getByText('0 of 4 houseguests')).toBeTruthy()
  })
  it('sorts competition wins and puts missing scores after a real zero', async () => {
    render(<BigBrotherStandings leagueId="l" />)
    await screen.findByRole('heading', { name: 'House standings' })
    fireEvent.change(screen.getByLabelText('Order by'), { target: { value: 'veto' } })
    const region = screen.getByRole('region', { name: 'Big Brother season standings' })
    expect(within(region).getAllByRole('rowheader')[0].textContent).toContain('Team c')
    fireEvent.change(screen.getByLabelText('Order by'), { target: { value: 'points' } })
    expect(within(region).getAllByRole('rowheader')[0].textContent).toBe('Team a')
  })
  it('offers retry on failure and successfully recovers', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    render(<BigBrotherStandings leagueId="l" />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Retry standings' }))
    await screen.findByRole('heading', { name: 'House standings' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('retains last loaded results on transient refresh failure but clears them if access is revoked', async () => {
    render(<BigBrotherStandings leagueId="l" />)
    await screen.findByRole('heading', { name: 'House standings' })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh standings' }))
    await screen.findByText(/Showing the last loaded standings/)
    expect(screen.getByRole('table')).toBeTruthy()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh standings' }))
    await screen.findByText('You do not have access to this league.')
    expect(screen.queryByRole('table')).toBeNull()
  })
  it('does not display or accept a stale response after switching leagues', async () => {
    let resolveOld: (v: unknown) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const view = render(<BigBrotherStandings leagueId="old" />)
    view.rerender(<BigBrotherStandings leagueId="l" />)
    await screen.findByRole('heading', { name: 'House standings' })
    resolveOld({ ok: true, json: async () => ({ ...data(), leagueId: 'old', rows: [] }) })
    await waitFor(() => expect(screen.getByText('4 of 4 houseguests')).toBeTruthy())
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  })
  it('shows setup and genuinely empty leagues without fabricated houseguests', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...data(), state: 'setup', rows: [], history: [], remainingCount: 0, juryCount: 0 }) })
    render(<BigBrotherStandings leagueId="l" />)
    await screen.findByText('No houseguests have been added to this league yet.')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/commissioner starts the first cycle/)).toBeTruthy()
  })
})
