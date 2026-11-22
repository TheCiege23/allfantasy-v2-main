import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/*
 * The Commissioner Hub guide (2026-11-13). Found on the owner's account: "23 need a commissioner ·
 * 107 managers inactive" at the top, 22 of the 23 being "No manager has made a move in 14 days" on
 * leagues not in season — while the ladder further down, on the same leagues, said nobody was on it.
 * Pinned here: off-season leagues raise no quiet item and count no inactive managers; each card names
 * what is waiting; same-name leagues are told apart; the headline is the count of things waiting.
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
import { commissionerGuide } from '@/lib/core-app/commissionerGuide'
import { NO_REVIEW_SIGNALS } from '@/lib/core-app/commissioner/signals'

const NOW = new Date('2026-11-13T15:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const counts = { zombie: 0, tournament: 0, survivor: 0, c2c: 0, guillotine: 0, efl: 0 }

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `League ${id}`,
    userId: 'u1',
    platform: 'sleeper',
    leagueSize: 3,
    leagueType: 'redraft',
    leagueVariant: null,
    isDynasty: false,
    guillotineMode: false,
    bestBallMode: false,
    status: 'in_season',
    lifecycleState: 'in_season',
    lastSyncedAt: new Date(NOW.getTime() - HOUR),
    syncStatus: 'ok',
    season: 2026,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  }
}
const team = (leagueId: string, teamName: string, n: number, orphan = false) => ({
  leagueId,
  teamName,
  ownerName: orphan ? null : teamName.toLowerCase(),
  platformUserId: orphan ? null : `${leagueId}-p${n}`,
  claimedByUserId: null,
  isOrphan: orphan,
})
/** Every manager quiet for 40 days — "the league being quiet". */
const allQuiet = (names: string[]) => ({
  native: false,
  managers: names.map((managerName) => ({ managerName, currentCount: 0, priorCount: 0, lastActionAt: new Date(NOW.getTime() - 40 * DAY) })),
  window: { lastActivityAt: new Date(NOW.getTime() - HOUR), eventCount: 3 },
})

describe('getCommissionerOverview — the guide rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    formats.readFormatMembership.mockResolvedValue({ members: [], formatIds: {}, counts, eflPins: new Map() })
    formats.readMentions.mockResolvedValue([])
    m.tournamentShell.count.mockResolvedValue(0)
    signals.readReviewSignals.mockResolvedValue({ byLeague: new Map(), partial: false })
  })

  it('an off-season league raises no "no moves" item and counts no inactive managers; in season it does', async () => {
    run.listBroadcastLeagues.mockResolvedValue([
      { id: 'OFF', platform: 'sleeper', native: false },
      { id: 'ON', platform: 'sleeper', native: false },
    ])
    m.league.findMany.mockResolvedValue([row('OFF', { status: 'pre_draft', lifecycleState: 'pre_draft' }), row('ON')])
    m.leagueTeam.findMany.mockResolvedValue([
      team('OFF', 'A', 1), team('OFF', 'B', 2), team('OFF', 'C', 3),
      team('ON', 'D', 1), team('ON', 'E', 2), team('ON', 'F', 3),
    ])
    activity.readMemberActivityInputs.mockImplementation(async (id: string) => allQuiet(id === 'OFF' ? ['A', 'B', 'C'] : ['D', 'E', 'F']))

    const data = await getCommissionerOverview({ userId: 'u1', candidateLeagueIds: ['OFF', 'ON'], issues: [], now: NOW })

    expect(data.queue.filter((q) => q.leagueId === 'OFF')).toEqual([])
    expect(data.queue.some((q) => q.leagueId === 'ON' && q.source === 'health')).toBe(true)
    const off = data.leagues.find((l) => l.leagueId === 'OFF')!
    expect(off.offSeason).toBe(true)
    expect(off.needsYou).toBe(0)
    expect(off.activity).toMatchObject({ tone: 'muted' })
    const on = data.leagues.find((l) => l.leagueId === 'ON')!
    expect(on.offSeason).toBe(false)
    expect(on.topItem).toBe(data.queue.find((q) => q.leagueId === 'ON')!.title)
    // Only the in-season league's three managers count.
    expect(data.stats[1]).toMatchObject({ value: '3' })
    expect(data.summary).toMatchObject({ todo: data.queue.length, leaguesWithNothing: 1 })
  })

  it('still flags an unowned seat off-season — it needs filling before the draft too', async () => {
    run.listBroadcastLeagues.mockResolvedValue([{ id: 'OFF', platform: 'sleeper', native: false }])
    m.league.findMany.mockResolvedValue([row('OFF', { status: 'pre_draft', lifecycleState: 'pre_draft' })])
    m.leagueTeam.findMany.mockResolvedValue([team('OFF', 'A', 1), team('OFF', 'Empty', 2, true), team('OFF', 'Gone', 3, true)])
    activity.readMemberActivityInputs.mockResolvedValue(allQuiet(['A']))

    const data = await getCommissionerOverview({ userId: 'u1', candidateLeagueIds: ['OFF'], issues: [], now: NOW })

    expect(data.queue).toHaveLength(1)
    expect(data.queue[0]).toMatchObject({ leagueId: 'OFF', severity: 'bad', source: 'health' })
    expect(data.leagues[0].topItem).toBe(data.queue[0]!.title)
  })

  it('tells apart leagues with the same name — by season, else by the day each was created', async () => {
    run.listBroadcastLeagues.mockResolvedValue([
      { id: 'X', platform: 'sleeper', native: false },
      { id: 'Y', platform: 'sleeper', native: false },
      { id: 'Z', platform: 'sleeper', native: false },
    ])
    m.league.findMany.mockResolvedValue([
      row('X', { name: 'Twin', createdAt: new Date('2026-10-03T00:00:00Z') }),
      row('Y', { name: 'Twin', createdAt: new Date('2026-10-07T00:00:00Z') }),
      row('Z', { name: 'Solo' }),
    ])
    m.leagueTeam.findMany.mockResolvedValue([])
    activity.readMemberActivityInputs.mockResolvedValue({ native: false, managers: [], window: { lastActivityAt: null, eventCount: 0 } })
    signals.readReviewSignals.mockResolvedValue({ byLeague: new Map([['X', { ...NO_REVIEW_SIGNALS }]]), partial: false })

    const data = await getCommissionerOverview({ userId: 'u1', candidateLeagueIds: ['X', 'Y', 'Z'], issues: [], now: NOW })
    const sub = (id: string) => data.leagues.find((l) => l.leagueId === id)!.sub

    expect(sub('X')).toMatch(/created Oct 3$/)
    expect(sub('Y')).toMatch(/created Oct 7$/)
    expect(sub('Z')).not.toMatch(/created/)
  })
})

describe('commissionerGuide — the headline and its chips', () => {
  const base = { runCount: 51, queue: [], leagues: [], ladder: [] } as unknown as CommissionerOverviewData

  it('says how many things need you, and what kind, each chip a link to them', () => {
    const g = commissionerGuide({ ...base, summary: { todo: 5, trades: 2, quiet: 3, resync: 1, leaguesWithNothing: 9 } })
    expect(g.headline).toBe('5 things need you across 51 leagues')
    expect(g.chips.map((c) => [c.label, c.href])).toEqual([
      ['2 trades to review', '#afh-queue'],
      ['3 quiet managers mid-season', '#af-ladder'],
      ['1 league to re-sync', '/core/sync'],
      ['9 leagues with nothing waiting', '#afh-leagues'],
    ])
  })

  it('says so plainly when nothing needs you, and draws no zero chips', () => {
    const g = commissionerGuide({ ...base, summary: { todo: 0, trades: 0, quiet: 0, resync: 0, leaguesWithNothing: 0 } })
    expect(g.headline).toBe('Nothing needs you in the 51 leagues you run')
    expect(g.chips).toEqual([])
  })
})

describe('<CommissionerOverview /> — the guide layout', () => {
  const card = (id: string, needsYou: number, topItem: string | null) => ({
    leagueId: id,
    variant: null,
    name: `League ${id}`,
    platform: 'sleeper',
    sub: 'Sleeper · 10 managers',
    activity: { active: 10, total: 10, tone: 'good' as const },
    needsYou,
    worst: needsYou > 0 ? ('warn' as const) : null,
    topItem,
    offSeason: false,
    sync: { label: 'Synced', tone: 'good' as const },
    href: `/core/commissioner?league=${id}`,
  })
  const data: CommissionerOverviewData = {
    runCount: 3,
    formatCounts: counts,
    leagues: [card('A', 2, '1 trade awaiting your review'), card('B', 0, null), card('C', 0, null)],
    stats: [],
    queue: [
      { id: 'A:t', severity: 'warn', source: 'review', title: '1 trade awaiting your review', detail: 'Review it before it processes.', due: null, action: null, leagueId: 'A', leagueName: 'League A' },
      { id: 'A:s', severity: 'info', source: 'issue', title: 'Draft order not set', detail: '', due: null, action: null, leagueId: 'A', leagueName: 'League A' },
    ],
    activityChecked: 3,
    mentions: [],
    broadcastLeagueIds: [],
    ownsAny: true,
    tournament: { count: 0, show: false },
    partial: false,
    ladder: [],
    ladderLeagues: 3,
    summary: { todo: 2, trades: 1, quiet: 0, resync: 0, leaguesWithNothing: 2 },
  }

  it('leads with the count of things waiting, then the to-do list, and names what each league is waiting on', () => {
    const { container } = render(<CommissionerOverview data={data} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('2 things need you across 3 leagues')
    expect(screen.getByRole('heading', { name: 'Your to-do list' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '1 trade to review' }).getAttribute('href')).toBe('#afh-queue')
    expect(container.querySelector('.cmg-top')?.textContent).toBe('1 trade awaiting your review · +1 more')
    // The to-do list comes before the league cards.
    const order = [...container.querySelectorAll('#afh-queue, #afh-run')].map((e) => e.id)
    expect(order).toEqual(['afh-queue', 'afh-run'])
  })

  it('folds leagues with nothing waiting into one line, and the extras into "More commissioner tools"', () => {
    const { container } = render(<CommissionerOverview data={data} />)
    const clear = screen.getByTestId('commissioner-clear-leagues')
    expect(clear.querySelector('summary')?.textContent).toBe('2 leagues with nothing waiting')
    expect(clear.hasAttribute('open')).toBe(false)
    const more = screen.getByTestId('commissioner-more')
    expect(more.hasAttribute('open')).toBe(false)
    expect(more.querySelector('a[href="/commissioner-os"]')).not.toBeNull()
    expect(more.querySelector('#afh-mentions')).not.toBeNull()
    expect(container.querySelector('.afh-foot a')).toBeNull()
  })
})
