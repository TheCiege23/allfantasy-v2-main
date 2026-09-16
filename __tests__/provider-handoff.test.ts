// @vitest-environment node
/**
 * One-tap provider handoff (user decision, 2026-09-14): Core triage, notification rows,
 * the since-last-visit brief and the matchup screen link to the provider screen that acts
 * on what the user is looking at — and ONLY to a verified one. MFL, Fantrax and
 * Fleaflicker keep their in-app destination; nothing is ever a guessed URL.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  notifications: vi.fn(),
  count: vi.fn(),
  discord: vi.fn(),
  teams: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformNotification: {
      findMany: (...a: unknown[]) => h.notifications(...a),
      count: (...a: unknown[]) => h.count(...a),
    },
    discordLeagueChannel: { findFirst: (...a: unknown[]) => h.discord(...a) },
    leagueTeam: { findMany: (...a: unknown[]) => h.teams(...a) },
  },
}))

import { handoffFor, verifiedHandoff } from '@/lib/core-app/platformLinks'
import { deriveOutstandingIssues } from '@/lib/core-app/outstandingIssues'
import { getNotificationsCenter } from '@/lib/core-app/notificationsCenter'
import { attachBriefHandoffs, type SinceLastVisitBrief } from '@/lib/core-app/sinceLastVisit'

const SLEEPER = { id: 'LS', platform: 'sleeper', platformLeagueId: '111', season: 2026, name: 'Dynasty' }
const ESPN = { id: 'LE', platform: 'espn', platformLeagueId: '888', season: 2026, name: 'Gridiron' }
const YAHOO = { id: 'LY', platform: 'yahoo', platformLeagueId: '449.l.1361311', season: 2026, name: 'Waiver Warriors' }

describe('verifiedHandoff — the named screen, verified, or nothing', () => {
  it('Sleeper lands on the exact screen without a team id', () => {
    expect(verifiedHandoff(SLEEPER, 'lineup')).toMatchObject({
      href: 'https://sleeper.com/leagues/111/team',
      label: 'Open in Sleeper',
      screen: 'Lineup',
      external: true,
    })
    expect(verifiedHandoff(SLEEPER, 'trade')?.href).toBe('https://sleeper.com/leagues/111/trades')
    expect(verifiedHandoff(SLEEPER, 'waivers')?.href).toBe('https://sleeper.com/leagues/111/players')
    expect(verifiedHandoff(SLEEPER, 'league')?.href).toBe('https://sleeper.com/leagues/111/league')
  })

  it('ESPN and Yahoo lineups need YOUR team id, and never borrow the league page under that name', () => {
    expect(verifiedHandoff(ESPN, 'lineup')).toBeNull()
    expect(verifiedHandoff({ ...ESPN, teamId: '7' }, 'lineup')?.href).toBe(
      'https://fantasy.espn.com/football/team?leagueId=888&teamId=7&seasonId=2026',
    )
    expect(verifiedHandoff({ ...YAHOO, teamId: '449.l.1361311.t.3' }, 'lineup')?.href).toBe(
      'https://football.fantasysports.yahoo.com/f1/1361311/3',
    )
  })

  it('handoffFor falls back to the verified league page, labelled as the league', () => {
    expect(handoffFor(ESPN, 'lineup')).toMatchObject({
      href: 'https://fantasy.espn.com/football/league?leagueId=888&seasonId=2026',
      screen: 'League',
    })
  })

  it('🛑 MFL, Fantrax and Fleaflicker get NOTHING — not even their homepage (user decision)', () => {
    for (const platform of ['mfl', 'fantrax', 'fleaflicker']) {
      for (const screen of ['league', 'lineup', 'waivers', 'trade'] as const) {
        expect(verifiedHandoff({ id: 'x', platform, platformLeagueId: '42', season: 2026 }, screen)).toBeNull()
        expect(handoffFor({ id: 'x', platform, platformLeagueId: '42', season: 2026 }, screen)).toBeNull()
      }
    }
  })

  it('a native league, or a provider league with no provider id, gets nothing', () => {
    expect(handoffFor({ id: 'n', platform: 'manual' }, 'league')).toBeNull()
    expect(handoffFor({ id: 's', platform: 'sleeper', platformLeagueId: null }, 'lineup')).toBeNull()
  })
})

describe('triage issues link to the verified league page', () => {
  const now = new Date('2026-09-14T12:00:00Z')
  const base = { name: 'L', sport: 'NFL', format: 'redraft', teamCount: 12, season: 2026, draftDate: '2026-09-15T00:00:00Z' }

  it('🛑 replaces the homepages and the internal-id Sleeper URL', () => {
    const { issues } = deriveOutstandingIssues({
      leagues: [
        { ...base, id: 'a', platform: 'sleeper', platformLeagueId: '111' },
        { ...base, id: 'b', platform: 'espn', platformLeagueId: '888' },
        { ...base, id: 'c', platform: 'mfl', platformLeagueId: '42' },
        // No provider id: the old code built sleeper.com/leagues/<AllFantasy row id>.
        { ...base, id: 'd', platform: 'sleeper' },
      ] as never,
      now,
    })
    const draft = (id: string) => issues.find((i) => i.id === `${id}:draft`)
    expect(draft('a')?.action).toEqual({ label: 'Open in Sleeper', href: 'https://sleeper.com/leagues/111/league', external: true })
    expect(draft('b')?.action).toEqual({
      label: 'Open in ESPN',
      href: 'https://fantasy.espn.com/football/league?leagueId=888&seasonId=2026',
      external: true,
    })
    expect(draft('c')?.action).toBeNull()
    expect(draft('d')?.action).toBeNull()
    expect(issues.some((i) => i.action?.href.includes('/leagues/d'))).toBe(false)
  })
})

describe('notification rows get a provider handoff by kind', () => {
  const row = (id: string, league: typeof SLEEPER | { id: string; platform: string; platformLeagueId: string; season: number; name: string } | null, type: string, title: string) => ({
    id,
    type,
    title,
    body: null,
    severity: 'medium',
    createdAt: new Date('2026-09-14T10:00:00Z'),
    readAt: null,
    leagueId: league?.id ?? null,
    meta: null,
    league: league ? { name: league.name, platform: league.platform, platformLeagueId: league.platformLeagueId, season: league.season } : null,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    h.count.mockResolvedValue(0)
    h.discord.mockResolvedValue(null)
    h.teams.mockResolvedValue([
      { leagueId: 'LY', externalId: '449.l.1361311.t.3' },
      { leagueId: 'LE', externalId: '7' },
    ])
  })

  it('picks the trade, waivers, lineup or league screen, verified only', async () => {
    const ESPN2 = { id: 'LE2', platform: 'espn', platformLeagueId: '999', season: 2026, name: 'No team here' }
    const MFL = { id: 'LM', platform: 'mfl', platformLeagueId: '42', season: 2026, name: 'MFL league' }
    h.notifications.mockResolvedValue([
      row('r1', SLEEPER, 'trade_proposed', 'Trade offer waiting'),
      row('r2', ESPN, 'waiver_processed', 'Waiver claim processed'),
      row('r3', YAHOO, 'lineup_lock', 'Set your lineup before kickoff'),
      row('r4', ESPN2, 'lineup_lock', 'Set your lineup before kickoff'),
      row('r5', MFL, 'lineup_lock', 'Set your lineup before kickoff'),
      row('r6', null, 'system', 'Welcome'),
    ])

    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: new Date('2026-09-14T12:00:00Z') })
    const handoff = (id: string) => data.rest.find((r) => r.id === id)?.handoff

    expect(handoff('r1')).toEqual({ href: 'https://sleeper.com/leagues/111/trades', label: 'Open in Sleeper', screen: 'Trade' })
    expect(handoff('r2')?.href).toBe('https://fantasy.espn.com/football/players/add?leagueId=888&seasonId=2026')
    expect(handoff('r3')).toMatchObject({ href: 'https://football.fantasysports.yahoo.com/f1/1361311/3', screen: 'Lineup' })
    // No claimed team: the lineup screen cannot be built, so the league page — labelled as such.
    expect(handoff('r4')).toMatchObject({ href: 'https://fantasy.espn.com/football/league?leagueId=999&seasonId=2026', screen: 'League' })
    expect(handoff('r5')).toBeUndefined()
    expect(handoff('r6')).toBeUndefined()

    const select = (h.notifications.mock.calls[0][0] as { select: { league: { select: Record<string, boolean> } } }).select
    expect(select.league.select).toMatchObject({ platformLeagueId: true, season: true })
    const teamsWhere = (h.teams.mock.calls[0][0] as { where: { leagueId: { in: string[] }; claimedByUserId: string } }).where
    expect([...teamsWhere.leagueId.in].sort()).toEqual(['LE', 'LE2', 'LY'])
    expect(teamsWhere.claimedByUserId).toBe('u1')
  })

  it('an all-Sleeper feed never reads team ids', async () => {
    h.notifications.mockResolvedValue([row('r1', SLEEPER, 'trade_proposed', 'Trade offer waiting')])
    await getNotificationsCenter({ userId: 'u1', issues: [], now: new Date('2026-09-14T12:00:00Z') })
    expect(h.teams).not.toHaveBeenCalled()
  })
})

describe('the brief gets handoffs on trades and single-league injuries', () => {
  const brief = (): SinceLastVisitBrief => ({
    sinceAt: '2026-09-13T00:00:00Z',
    // Equal to `sinceAt` unless a blind trades read left the trade boundary held further back.
    tradesSinceAt: '2026-09-13T00:00:00Z',
    firstVisit: false,
    windowCapped: false,
    trades: {
      items: [
        { leagueId: 'LS', leagueName: 'Dynasty', acceptedAt: '2026-09-13T10:00:00Z', summary: 'A got B' },
        { leagueId: 'LM', leagueName: 'MFL league', acceptedAt: '2026-09-13T11:00:00Z', summary: 'C got D' },
      ],
      atLeast: false,
    },
    injuries: [
      { playerId: 'p1', name: 'One League', position: 'RB', from: null, to: 'Out', leagues: ['Waiver Warriors'], leagueIds: ['LY'] },
      { playerId: 'p2', name: 'Two Leagues', position: 'WR', from: null, to: 'Out', leagues: ['Dynasty', 'Waiver Warriors'], leagueIds: ['LS', 'LY'] },
      { playerId: 'p3', name: 'No Ids', position: 'TE', from: null, to: 'Out', leagues: ['Dynasty'] },
    ],
    standings: [],
    alerts: { total: 0, groups: [] },
    comparisonPending: false,
  })

  it('links a trade to its trade screen and a one-league injury to your lineup there', () => {
    const out = attachBriefHandoffs(
      brief(),
      [SLEEPER, YAHOO, { id: 'LM', platform: 'mfl', platformLeagueId: '42', season: 2026, name: 'MFL league' }],
      new Map([['LY', '3']]),
    )
    expect(out.trades.items[0].handoff).toEqual({ href: 'https://sleeper.com/leagues/111/trades', label: 'Open in Sleeper', screen: 'Trade' })
    expect(out.trades.items[1]).not.toHaveProperty('handoff')
    expect(out.injuries[0].handoff).toMatchObject({ href: 'https://football.fantasysports.yahoo.com/f1/1361311/3', screen: 'Lineup' })
    // Several leagues: which lineup to open is the user's call, so no single button.
    expect(out.injuries[1]).not.toHaveProperty('handoff')
    expect(out.injuries[2]).not.toHaveProperty('handoff')
  })
})

describe('the matchup loader gates its lineup link on YOUR team', () => {
  it('builds lineupLink from the claimed team, verified-only', () => {
    const src = readFileSync(join(process.cwd(), 'lib/core-app/matchup.ts'), 'utf8')
    expect(src).toMatch(/lineupLink = myTeam\?\.externalId\s*\?\s*verifiedHandoff\(/)
    expect(src).toContain("'lineup'")
  })
})
