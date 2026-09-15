import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/*
 * Multi-league format hubs (/core/hubs/<format>), 2026-09-13.
 *
 * ⚠ THESE ARE HONESTY RULES, NOT LAYOUT CHECKS. The handoff drew sample leagues,
 * sample managers and percentages the product has no source for. What the hub
 * must NOT do is the product: count a league into a format it isn't in, list a
 * league the reader can't open, offer a broadcast the route will refuse, show a
 * manager's email, or call a failed read an empty one.
 */

const m = vi.hoisted(() => ({
  league: { findMany: vi.fn() },
  guillotineLeagueConfig: { findMany: vi.fn() },
  c2CLeague: { findMany: vi.fn() },
  zombieLeague: { findMany: vi.fn() },
  survivorGameState: { findMany: vi.fn() },
  tournamentLeague: { findMany: vi.fn() },
  guillotineRosterState: { findMany: vi.fn() },
  guillotinePeriodScore: { groupBy: vi.fn() },
  zombieLeagueTeam: { groupBy: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  leagueChatMessage: { findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m }))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: vi.fn(async () => null) }))
vi.mock('@/lib/core-app/tradesBoard', () => ({
  getTradesBoard: vi.fn(async () => ({
    pending: [
      { id: 'p1', leagueId: 'L1', leagueName: 'Chop Shop', platform: 'sleeper', logoUrl: null, status: 'pending', expiresAt: null, youProposed: true, items: [{ itemType: 'player', reference: 'x', faabAmount: null }] },
      { id: 'p9', leagueId: 'L6', leagueName: 'Plain Redraft', platform: 'sleeper', logoUrl: null, status: 'pending', expiresAt: null, youProposed: false, items: [] },
    ],
    windows: [],
    considered: 2,
    deadlineUnknown: 0,
    currentWeek: null,
  })),
}))

import { getFormatHub, parseHubFormat } from '@/lib/core-app/formatHubs'
import FormatHub from '@/components/core-app/screens/FormatHub'
import type { FormatHubData } from '@/lib/core-app/formatHubs'

const USER = 'u1'
const member = (over: Record<string, unknown>) => ({
  platform: 'sleeper',
  platformLeagueId: 'pl',
  leagueSize: 12,
  userId: 'someone-else',
  leagueType: 'redraft',
  guillotineMode: false,
  lastSyncedAt: null,
  syncStatus: null,
  ...over,
})

const MEMBERS = [
  member({ id: 'L1', name: 'Chop Shop', userId: USER, guillotineMode: true }),
  member({ id: 'L2', name: 'Axe Club', leagueSize: 10 }), // guillotine only via its config row
  member({ id: 'L3', name: 'Campus Kings', leagueType: 'c2c' }),
  member({ id: 'L4', name: 'Rome', leagueSize: 32 }),
  member({ id: 'L5', name: 'Half Pinned' }),
  member({ id: 'L6', name: 'Plain Redraft' }),
]

beforeEach(() => {
  for (const d of Object.values(m)) for (const fn of Object.values(d)) (fn as ReturnType<typeof vi.fn>).mockReset()

  m.league.findMany.mockImplementation(async (args: { select?: { settings?: boolean } }) =>
    args.select?.settings
      ? [
          { id: 'L4', settings: { conceptRules: { extensions: { commissionerTemplate: { id: 'efl_promotion_relegation_dynasty', version: '1.2.0' } } } } },
          // Matched by the JSON path filter but carries no version: the canonical reader must reject it.
          { id: 'L5', settings: { conceptRules: { commissionerTemplate: { id: 'efl_promotion_relegation_dynasty' } } } },
        ]
      : MEMBERS,
  )
  m.guillotineLeagueConfig.findMany.mockResolvedValue([{ leagueId: 'L2' }])
  m.c2CLeague.findMany.mockResolvedValue([{ leagueId: 'L3', campusScoreWeight: 0.4, cantonScoreWeight: 0.6 }])
  m.zombieLeague.findMany.mockResolvedValue([])
  m.survivorGameState.findMany.mockResolvedValue([])
  m.tournamentLeague.findMany.mockResolvedValue([])
  m.guillotineRosterState.findMany.mockResolvedValue([
    ...Array.from({ length: 3 }, () => ({ leagueId: 'L1', choppedAt: new Date('2026-09-10') })),
    ...Array.from({ length: 9 }, () => ({ leagueId: 'L1', choppedAt: null })),
  ])
  m.guillotinePeriodScore.groupBy.mockResolvedValue([{ leagueId: 'L1', _max: { weekOrPeriod: 4 } }])
  m.zombieLeagueTeam.groupBy.mockResolvedValue([])
  m.leagueTeam.findMany.mockResolvedValue([{ leagueId: 'L4', currentRank: 3 }])
  m.leagueChatMessage.findMany.mockResolvedValue([
    { id: 'c1', leagueId: 'L1', message: 'you are on the block', createdAt: new Date(), user: { displayName: null, username: 'dre' } },
  ])
})

describe('parseHubFormat', () => {
  it('accepts the six formats case-insensitively and nothing else', () => {
    expect(parseHubFormat('Guillotine')).toBe('guillotine')
    expect(parseHubFormat(' efl ')).toBe('efl')
    expect(parseHubFormat('dynasty')).toBeNull()
    expect(parseHubFormat(undefined)).toBeNull()
  })
})

describe('getFormatHub', () => {
  it('counts a league into a format only on real evidence', async () => {
    const hub = await getFormatHub(USER, 'guillotine')
    expect(hub.counts).toEqual({ zombie: 0, tournament: 0, survivor: 0, c2c: 1, guillotine: 2, efl: 1 })
  })

  it('rejects a half-written EFL pin that the JSON filter still matched', async () => {
    const hub = await getFormatHub(USER, 'efl')
    expect(hub.leagues.map((l) => l.leagueId)).toEqual(['L4'])
    expect(hub.leagues[0].status).toBe('Rules v1.2.0')
    expect(hub.leagues[0].meter).toMatchObject({ value: '#3 of 32' })
  })

  it('opens the first format the reader actually plays when none is asked for', async () => {
    const hub = await getFormatHub(USER, null)
    expect(hub.format).toBe('c2c')
  })

  it('reports teams remaining from roster states, not an invented chop-risk', async () => {
    const hub = await getFormatHub(USER, 'guillotine')
    const [own, other] = hub.leagues
    expect(own).toMatchObject({ leagueId: 'L1', youCommission: true, status: '3 chopped' })
    expect(own.meter).toMatchObject({ value: '9 of 12 left', pct: 75 })
    expect(other).toMatchObject({ leagueId: 'L2', status: 'No chops yet' })
    expect(hub.stats.map((s) => s.value)).toEqual(['2', '3', 'Wk 4'])
  })

  it('offers broadcast only for leagues the reader owns — the check the route applies', async () => {
    const hub = await getFormatHub(USER, 'guillotine')
    expect(hub.broadcastLeagueIds).toEqual(['L1'])
  })

  it('keeps trades from other leagues out of the hub', async () => {
    const hub = await getFormatHub(USER, 'guillotine')
    expect(hub.trades?.pending.map((t) => t.id)).toEqual(['p1'])
  })

  it('never selects an email for a mention author, and hides private replies meant for others', async () => {
    const hub = await getFormatHub(USER, 'guillotine')
    const args = m.leagueChatMessage.findMany.mock.calls[0][0]
    expect(Object.keys(args.select.user.select)).not.toContain('email')
    expect(args.where.OR).toEqual([{ isPrivate: false }, { visibleToUserId: USER }])
    expect(hub.mentions?.[0].author).toBe('@dre')
  })

  it('survives a table production has not migrated, and says the count may be low', async () => {
    m.zombieLeague.findMany.mockRejectedValue(new Error('relation "zombie_leagues" does not exist'))
    const hub = await getFormatHub(USER, 'guillotine')
    expect(hub.partial).toBe(true)
    expect(hub.counts.zombie).toBe(0)
    expect(hub.counts.guillotine).toBe(2)
  })
})

const fixture = (over: Partial<FormatHubData> = {}): FormatHubData => ({
  format: 'guillotine',
  counts: { zombie: 0, tournament: 0, survivor: 2, c2c: 0, guillotine: 1, efl: 0 },
  leagues: [
    {
      leagueId: 'L1',
      name: 'Chop Shop',
      platform: 'sleeper',
      sub: 'Sleeper · 12 managers',
      meter: null,
      detail: 'Team count not on file yet',
      status: 'No chops yet',
      statusTone: 'muted',
      href: '/core?league=L1',
      youCommission: false,
    },
  ],
  totalLeagues: 1,
  stats: [{ value: '1', label: 'league live', tone: 'accent' }],
  trades: null,
  mentions: [],
  broadcastLeagueIds: [],
  partial: false,
  ...over,
})

describe('<FormatHub />', () => {
  it('marks the open hub and links every other format by path', () => {
    render(<FormatHub data={fixture()} />)
    const current = screen.getByRole('link', { name: 'Guillotine' })
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Survivor · 2' }).getAttribute('href')).toBe('/core/hubs/survivor')
  })

  it('draws no meter bar for a league with nothing on file', () => {
    render(<FormatHub data={fixture()} />)
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByText('Team count not on file yet')).toBeTruthy()
  })

  it('opens every connected league tool from the hub and graphs real meter values', () => {
    render(<FormatHub data={fixture({
      leagues: [{
        ...fixture().leagues[0],
        meter: { value: '9 of 12 left', pct: 75, tone: 'good' },
        youCommission: true,
      }],
    })} />)
    expect(screen.getByRole('img', { name: /Guillotine league comparison/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Standings' }).getAttribute('href')).toBe('/core/standings?league=L1')
    expect(screen.getByRole('link', { name: 'Trades' }).getAttribute('href')).toBe('/core/trades?league=L1')
    expect(screen.getByRole('link', { name: 'Commissioner OS' }).getAttribute('href')).toBe('/core/commissioner?league=L1')
  })

  it('does not offer a broadcast the route would refuse', () => {
    render(<FormatHub data={fixture()} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/don’t commission any of these/)).toBeTruthy()
  })

  it('tells a failed trade read apart from an empty trade log', () => {
    const { unmount } = render(<FormatHub data={fixture({ trades: null })} />)
    expect(screen.getByText(/read failure, not an empty trade log/)).toBeTruthy()
    unmount()
    render(<FormatHub data={fixture({ trades: { pending: [], completed: [] } })} />)
    expect(screen.getByText('No offers waiting in these leagues.')).toBeTruthy()
  })

  it('shows an honest empty hub instead of sample leagues', () => {
    render(<FormatHub data={fixture({ leagues: [], totalLeagues: 0, stats: [], trades: null, mentions: null })} />)
    expect(screen.getByText('You’re not in a guillotine league yet')).toBeTruthy()
    expect(screen.queryByText('Chop Shop')).toBeNull()
    expect(screen.queryByText(/The Chopping Block|@mikek/)).toBeNull()
  })

  it('uses H.264 key art, never the source HEVC files', () => {
    const { container } = render(<FormatHub data={fixture()} />)
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/league-type-guillotine-hub.mp4')
    expect(container.innerHTML).not.toContain('hf_20260914')
  })
})
