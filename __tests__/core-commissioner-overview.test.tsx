import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

/*
 * Commissioner Hub, all leagues — /core/commissioner (five-doors restyle, 2026-09-17).
 *
 * The loader rules worth pinning: which leagues count as "you run", that manager
 * activity is read only for the cards drawn (and never on data too old to judge),
 * that the queue is ranked across leagues, and that a flood of stale leagues is said
 * once. The screen rules: one switcher, a composer only where a send would be
 * accepted, Commissioner OS offered only to someone it admits, and no link to the
 * retired /commissioner-hub.
 */

const m = vi.hoisted(() => ({
  league: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  tournamentShell: { count: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m }))
vi.mock('@/lib/core-app/leagueHome', () => ({
  leagueDisplayName: (n: string | null | undefined) => n?.trim() || 'Untitled league',
}))

const run = vi.hoisted(() => ({ listBroadcastLeagues: vi.fn() }))
vi.mock('@/lib/commissioner/broadcastAccess', () => run)

const formats = vi.hoisted(() => ({
  HUB_FORMATS: ['zombie', 'tournament', 'survivor', 'c2c', 'guillotine', 'efl'],
  readFormatMembership: vi.fn(),
  readMentions: vi.fn(),
}))
vi.mock('@/lib/core-app/formatHubs', () => formats)

const signals = vi.hoisted(() => ({ readReviewSignals: vi.fn() }))
vi.mock('@/lib/core-app/commissioner/signalReads', () => signals)

const activity = vi.hoisted(() => ({ readMemberActivityInputs: vi.fn() }))
vi.mock('@/lib/core-app/commissioner/memberActivityReads', () => activity)

import { getCommissionerOverview, type CommissionerOverviewData } from '@/lib/core-app/commissionerOverview'
import { CommissionerOverview } from '@/components/core-app/screens/CommissionerOverview'
import { NO_REVIEW_SIGNALS } from '@/lib/core-app/commissioner/signals'

const NOW = new Date('2026-10-12T15:00:00Z')
const USER = 'u1'
const HOUR = 3_600_000

const counts = { zombie: 0, tournament: 0, survivor: 0, c2c: 0, guillotine: 2, efl: 0 }

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `League ${id}`,
    userId: USER,
    platform: 'sleeper',
    leagueSize: 10,
    leagueType: 'redraft',
    leagueVariant: null,
    isDynasty: false,
    guillotineMode: false,
    bestBallMode: false,
    status: 'in_season',
    lifecycleState: 'in_season',
    lastSyncedAt: new Date(NOW.getTime() - HOUR),
    syncStatus: 'ok',
    ...over,
  }
}

describe('getCommissionerOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    formats.readFormatMembership.mockResolvedValue({ members: [], formatIds: {}, counts, eflPins: new Map() })
    formats.readMentions.mockResolvedValue([])
    m.tournamentShell.count.mockResolvedValue(0)
    m.leagueTeam.findMany.mockResolvedValue([])
    activity.readMemberActivityInputs.mockResolvedValue({ native: true, rows: [] })
    signals.readReviewSignals.mockResolvedValue({ byLeague: new Map(), partial: false })
  })

  it('keeps only the candidates the one-league gate admits, and asks it about nothing else', async () => {
    run.listBroadcastLeagues.mockResolvedValue([{ id: 'A', platform: 'sleeper', native: false }])
    m.league.findMany.mockResolvedValue([row('A')])
    signals.readReviewSignals.mockResolvedValue({ byLeague: new Map(), partial: false })

    const data = await getCommissionerOverview({ userId: USER, candidateLeagueIds: ['A', 'B'], issues: [], now: NOW })

    expect(run.listBroadcastLeagues).toHaveBeenCalledWith(USER, ['A', 'B'])
    expect(m.league.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['A'] } })
    expect(data.runCount).toBe(1)
    expect(data.formatCounts).toEqual(counts)
    expect(data.leagues.map((l) => l.href)).toEqual(['/core/commissioner?league=A'])
    // An imported league is never offered to the composer.
    expect(data.broadcastLeagueIds).toEqual([])
    expect(data.ownsAny).toBe(true)
  })

  it('reads no candidates at all for someone who runs nothing', async () => {
    const data = await getCommissionerOverview({ userId: USER, candidateLeagueIds: [], issues: [], now: NOW })
    expect(run.listBroadcastLeagues).not.toHaveBeenCalled()
    expect(m.league.findMany).not.toHaveBeenCalled()
    expect(data.runCount).toBe(0)
    expect(data.leagues).toEqual([])
  })

  it('does not judge activity on a league whose data is too old, and says why', async () => {
    run.listBroadcastLeagues.mockResolvedValue([{ id: 'OLD', platform: 'sleeper', native: false }])
    m.league.findMany.mockResolvedValue([row('OLD', { lastSyncedAt: new Date(NOW.getTime() - 9 * 24 * HOUR) })])
    signals.readReviewSignals.mockResolvedValue({ byLeague: new Map(), partial: false })

    const data = await getCommissionerOverview({ userId: USER, candidateLeagueIds: ['OLD'], issues: [], now: NOW })

    expect(activity.readMemberActivityInputs).not.toHaveBeenCalled()
    expect(data.leagues[0].activity).toEqual({ reason: 'Not measured: this league’s data is too old to judge' })
    expect(data.leagues[0].sync).toEqual({ label: 'Synced 9d ago', tone: 'warn' })
    expect(data.queue.map((q) => q.id)).toEqual(['OLD:stale-sync'])
    expect(data.stats[1]).toMatchObject({ value: '—' })
  })

  it('names inactive managers from moves and ranks the queue across leagues, worst first', async () => {
    run.listBroadcastLeagues.mockResolvedValue([
      { id: 'N', platform: 'native', native: true },
      { id: 'I', platform: 'sleeper', native: false },
    ])
    m.league.findMany.mockResolvedValue([row('N', { platform: 'native', lastSyncedAt: null }), row('I')])
    signals.readReviewSignals.mockResolvedValue({
      byLeague: new Map([['N', { ...NO_REVIEW_SIGNALS, tradesAwaitingReview: 1 }]]),
      partial: false,
    })
    m.leagueTeam.findMany.mockResolvedValue([
      { leagueId: 'I', teamName: 'A', ownerName: 'a', platformUserId: 'p1', claimedByUserId: null, isOrphan: false },
      { leagueId: 'I', teamName: 'B', ownerName: 'b', platformUserId: 'p2', claimedByUserId: null, isOrphan: false },
      { leagueId: 'I', teamName: 'Empty', ownerName: null, platformUserId: null, claimedByUserId: null, isOrphan: true },
      { leagueId: 'I', teamName: 'Gone', ownerName: null, platformUserId: null, claimedByUserId: null, isOrphan: true },
    ])
    activity.readMemberActivityInputs.mockImplementation(async (id: string) =>
      id === 'I'
        ? {
            native: false,
            managers: [],
            window: { lastActivityAt: new Date(NOW.getTime() - HOUR), eventCount: 5 },
          }
        : { native: true, rows: [] },
    )

    const data = await getCommissionerOverview({ userId: USER, candidateLeagueIds: ['N', 'I'], issues: [], now: NOW })

    // Two unowned seats in I is a `bad` card; N's trade review is `warn`.
    expect(data.queue[0]).toMatchObject({ leagueId: 'I', severity: 'bad', source: 'health' })
    expect(data.queue.some((q) => q.leagueId === 'N' && q.title === '1 trade awaiting your review')).toBe(true)
    // A native league has nothing to sync, so it is never "never synced".
    expect(data.queue.some((q) => q.leagueId === 'N' && /synced/.test(q.title))).toBe(false)
    expect(data.leagues.find((l) => l.leagueId === 'N')?.sync).toEqual({ label: 'Runs on AllFantasy', tone: 'good' })
    expect(data.broadcastLeagueIds).toEqual(['N'])
    expect(data.stats[2]).toMatchObject({ value: '1', label: 'trade awaiting review' })
  })

  it('says a flood of never-synced leagues once instead of once per league', async () => {
    const ids = ['S1', 'S2', 'S3', 'S4']
    run.listBroadcastLeagues.mockResolvedValue(ids.map((id) => ({ id, platform: 'sleeper', native: false })))
    m.league.findMany.mockResolvedValue(ids.map((id) => row(id, { lastSyncedAt: null })))
    signals.readReviewSignals.mockResolvedValue({ byLeague: new Map(), partial: false })

    const data = await getCommissionerOverview({ userId: USER, candidateLeagueIds: ids, issues: [], now: NOW })

    expect(data.queue.map((q) => q.title)).toEqual(['4 leagues you run have never synced'])
    expect(data.queue[0].severity).toBe('warn')
    expect(data.stats[3]).toMatchObject({ value: '4', label: 'leagues never synced', tone: 'bad' })
    expect(data.leagues.every((l) => l.sync.label === 'Never synced')).toBe(true)
  })

  it('keeps the collapsed row as urgent as the worst league it stands for', async () => {
    const ids = ['W1', 'W2', 'W3', 'W4']
    run.listBroadcastLeagues.mockResolvedValue(ids.map((id) => ({ id, platform: 'sleeper', native: false })))
    m.league.findMany.mockResolvedValue(ids.map((id) => row(id, { lastSyncedAt: new Date(NOW.getTime() - 9 * 24 * HOUR) })))

    const data = await getCommissionerOverview({ userId: USER, candidateLeagueIds: ids, issues: [], now: NOW })

    expect(data.queue.map((q) => [q.title, q.severity])).toEqual([['4 leagues you run need a re-sync', 'bad']])
    expect(data.stats[3]).toMatchObject({ value: '4', label: 'leagues need a re-sync' })
  })

  it('draws at most 12 cards and reads activity for those alone', async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `L${String(i).padStart(2, '0')}`)
    run.listBroadcastLeagues.mockResolvedValue(ids.map((id) => ({ id, platform: 'native', native: true })))
    m.league.findMany.mockResolvedValue(ids.map((id) => row(id, { platform: 'native' })))
    signals.readReviewSignals.mockResolvedValue({ byLeague: new Map(), partial: false })

    const data = await getCommissionerOverview({ userId: USER, candidateLeagueIds: ids, issues: [], now: NOW })

    expect(data.runCount).toBe(15)
    expect(data.leagues).toHaveLength(12)
    expect(activity.readMemberActivityInputs).toHaveBeenCalledTimes(12)
    expect(m.leagueTeam.findMany.mock.calls[0][0].where.leagueId.in).toHaveLength(12)
  })

  it('offers the tournament hub to a commissioner of three or more leagues', async () => {
    run.listBroadcastLeagues.mockResolvedValue([])
    const none = await getCommissionerOverview({ userId: USER, candidateLeagueIds: ['X'], issues: [], now: NOW })
    expect(none.tournament).toEqual({ count: 0, show: false })

    m.tournamentShell.count.mockResolvedValue(2)
    const some = await getCommissionerOverview({ userId: USER, candidateLeagueIds: ['X'], issues: [], now: NOW })
    expect(some.tournament).toEqual({ count: 2, show: true })
  })
})

function fixture(over: Partial<CommissionerOverviewData> = {}): CommissionerOverviewData {
  return {
    runCount: 2,
    formatCounts: counts,
    leagues: [
      {
        leagueId: 'A',
        name: 'Dynasty Dragons',
        platform: 'sleeper',
        sub: 'Sleeper · 12 managers · Dynasty',
        activity: { active: 11, total: 12, tone: 'warn' },
        needsYou: 2,
        worst: 'warn',
        sync: { label: 'Synced', tone: 'good' },
        href: '/core/commissioner?league=A',
      },
      {
        leagueId: 'B',
        name: 'Sunday Syndicate',
        platform: 'yahoo',
        sub: 'Yahoo · 14 managers',
        activity: { reason: 'Not measured: this league has never synced' },
        needsYou: 1,
        worst: 'warn',
        sync: { label: 'Never synced', tone: 'bad' },
        href: '/core/commissioner?league=B',
      },
    ],
    stats: [
      { value: '3', label: 'need a commissioner', tone: 'accent' },
      { value: '1', label: 'manager inactive', tone: 'bad' },
      { value: '0', label: 'trades awaiting review', tone: 'plain' },
      { value: '1', label: 'league never synced', tone: 'bad' },
    ],
    queue: [
      {
        id: 'A:flag:abandoned',
        severity: 'warn',
        source: 'health',
        title: '1 manager with no moves in 14 days',
        detail: 'No trade, waiver claim or roster move in 14 days: mtv.',
        due: null,
        action: { label: 'Replace a manager', href: '/core/commissioner?league=A#workflow-replace-manager', external: false },
        leagueId: 'A',
        leagueName: 'Dynasty Dragons',
      },
      {
        id: 'B:issue:B:never-synced',
        severity: 'warn',
        source: 'issue',
        title: 'This league has never synced',
        detail: 'Nothing has been read from Yahoo.',
        due: null,
        action: { label: 'Sync now', href: '/core/sync?league=B', external: false },
        leagueId: 'B',
        leagueName: 'Sunday Syndicate',
      },
    ],
    activityChecked: 1,
    mentions: [{ id: 'm1', author: '@lark', leagueName: 'Dynasty Dragons', at: NOW.toISOString(), text: 'can we push the deadline?' }],
    broadcastLeagueIds: [],
    ownsAny: true,
    tournament: { count: 0, show: false },
    partial: false,
    ...over,
  }
}

describe('<CommissionerOverview />', () => {
  it('puts "All leagues" first in the one switcher, marked current, with the formats after it', () => {
    render(<CommissionerOverview data={fixture()} />)
    const nav = screen.getByRole('navigation', { name: 'Commissioner hubs' })
    const links = within(nav).getAllByRole('link')
    expect(links[0].textContent).toBe('All leagues · 2')
    expect(links[0].getAttribute('aria-current')).toBe('page')
    expect(links[0].getAttribute('href')).toBe('/core/commissioner')
    expect(within(nav).getByRole('link', { name: 'Guillotine · 2' }).getAttribute('href')).toBe('/core/hubs/guillotine')
  })

  it('opens each league’s own commissioner screen and states an unmeasured league as unmeasured', () => {
    render(<CommissionerOverview data={fixture()} />)
    const opens = screen.getAllByRole('link', { name: 'Commissioner' }).map((a) => a.getAttribute('href'))
    expect(opens).toEqual(['/core/commissioner?league=A', '/core/commissioner?league=B'])
    expect(screen.getByRole('meter', { name: 'Active managers' }).getAttribute('aria-valuenow')).toBe('11')
    expect(screen.getAllByRole('meter')).toHaveLength(1)
    expect(screen.getByText('Not measured: this league has never synced')).toBeTruthy()
  })

  it('ranks by urgency and can group the same rows by league', () => {
    render(<CommissionerOverview data={fixture()} />)
    expect(screen.getByText(/1 manager with no moves in 14 days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'By league' }))
    expect(screen.getByText('Sunday Syndicate', { selector: '.afh-queue-group-name' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sync now' }).getAttribute('href')).toBe('/core/sync?league=B')
  })

  it('offers no send where the route would refuse one, and a composer where it would not', () => {
    const { unmount } = render(<CommissionerOverview data={fixture()} />)
    expect(screen.queryByRole('button', { name: 'Send @everyone' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    unmount()
    render(<CommissionerOverview data={fixture({ broadcastLeagueIds: ['A'] })} />)
    expect(screen.getByRole('button', { name: 'Send @everyone' })).toBeTruthy()
    expect(screen.getByRole('textbox').getAttribute('id')).toBe('afh-broadcast')
  })

  it('links Commissioner OS only for someone it admits, and never the retired page', () => {
    const { unmount } = render(<CommissionerOverview data={fixture()} />)
    expect(screen.getByRole('link', { name: 'Open Commissioner OS →' }).getAttribute('href')).toBe('/commissioner-os')
    expect(document.querySelector('a[href="/commissioner-hub"]')).toBeNull()
    unmount()
    render(<CommissionerOverview data={fixture({ ownsAny: false })} />)
    expect(screen.queryByRole('link', { name: 'Open Commissioner OS →' })).toBeNull()
  })

  it('shows an honest empty state with the two real ways in, not sample leagues', () => {
    render(<CommissionerOverview data={fixture({ runCount: 0, leagues: [], queue: [], mentions: null })} />)
    expect(screen.getByText('You don’t run a league yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create a league' }).getAttribute('href')).toBe('/create-league')
    expect(screen.getByRole('link', { name: 'Import a league' }).getAttribute('href')).toBe('/import')
    expect(screen.queryByText('Dynasty Dragons')).toBeNull()
  })
})
