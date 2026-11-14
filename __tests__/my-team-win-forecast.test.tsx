import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

const mocks = vi.hoisted(() => ({
  weeklyMatchupFindMany: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: mocks.weeklyMatchupFindMany },
    leagueTeam: { findMany: mocks.leagueTeamFindMany },
    roster: { findMany: mocks.rosterFindMany },
  },
}))

import { getNextMatchup, type MatchupLineupPricer } from '@/lib/core-app/nextMatchup'
import { forecastMatchup, UNATTRIBUTED_REASON, BEST_BALL_REASON } from '@/lib/core-app/matchupForecast'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { MyTeamData } from '@/lib/core-app/myTeam'

type Row = { playerId: string; projected: number | null; unavailable: boolean; actual: number | null; state: 'upcoming' | 'live' | 'final' | 'unknown' }
const up = (id: string, projected: number | null, extra: Partial<Row> = {}): Row => ({
  playerId: id, projected, unavailable: false, actual: 0, state: 'upcoming', ...extra,
})

function pricer(you: Row[], them: Row[]): MatchupLineupPricer {
  return async (lineups) =>
    new Map(
      [...lineups.keys()].map((rosterId) => {
        const rows = rosterId === '3' ? you : them
        const projected = rows.reduce((n, r) => n + (r.unavailable ? 0 : r.projected ?? 0), 0)
        return [rosterId, { projected, projectedFrom: rows.length, forecast: rows }]
      }),
    )
}

async function run(you: Row[], them: Row[], extra: { bestBall?: boolean } = {}) {
  return getNextMatchup({
    leagueId: 'league-1',
    platformLeagueId: '99',
    myExternalId: '3',
    userId: 'u1',
    seasonYear: 2026,
    week: 4,
    scoringSettings: { rec: 1 },
    projectionWeek: { season: '2026', week: 4 },
    priceLineups: pricer(you, them),
    ...extra,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.weeklyMatchupFindMany.mockResolvedValue([{ rosterId: '3', matchupId: 1 }, { rosterId: '7', matchupId: 1 }])
  mocks.leagueTeamFindMany.mockResolvedValue([
    { externalId: '3', teamName: 'BroVengers', ownerName: 'me', avatarUrl: null, platformUserId: 'p3' },
    { externalId: '7', teamName: 'Tigers', ownerName: 'them', avatarUrl: null, platformUserId: 'p7' },
  ])
  mocks.rosterFindMany.mockResolvedValue([
    { platformUserId: 'p3', playerData: { starters: ['a', 'b'] } },
    { platformUserId: 'p7', playerData: { starters: ['c', 'd'] } },
  ])
})

describe('My Team matchup card — one win probability', () => {
  it('is exactly what the shared forecast says for the same per-player numbers', async () => {
    const you = [up('a', 20), up('b', 15)]
    const them = [up('c', 10), up('d', 12)]
    const m = await run(you, them)
    const expected = forecastMatchup(
      { starters: you.map((r) => ({ ...r, actual: 0 })), teamPoints: 0, hasPlayerPoints: true },
      { starters: them.map((r) => ({ ...r, actual: 0 })), teamPoints: 0, hasPlayerPoints: true },
    )
    expect(m?.forecast).toEqual(expected)
    expect(m?.forecast?.available).toBe(true)
  })

  it('refuses, in the shared words, when a started starter has no score on file', async () => {
    const m = await run([up('a', 20, { state: 'final', actual: null }), up('b', 15)], [up('c', 10), up('d', 12)])
    expect(m?.forecast).toEqual({ available: false, refusal: 'unattributed', reason: UNATTRIBUTED_REASON })
  })

  it('banks a finished starter at his real points', async () => {
    const m = await run([up('a', 20, { state: 'final', actual: 31 }), up('b', 15)], [up('c', 10), up('d', 12)])
    expect(m?.forecast?.available).toBe(true)
    if (m?.forecast?.available) expect(m.forecast.projectedMargin).toBeGreaterThan(20)
  })

  it('declines in Best Ball', async () => {
    const m = await run([up('a', 20), up('b', 15)], [up('c', 10), up('d', 12)], { bestBall: true })
    expect(m?.forecast).toEqual({ available: false, refusal: 'best_ball', reason: BEST_BALL_REASON })
  })

  it('declines when a starter still to play cannot be priced (the KBFL kicker case)', async () => {
    const m = await run([up('a', 20), up('k', null)], [up('c', 10), up('d', 12)])
    expect(m?.forecast?.available).toBe(false)
    if (m?.forecast && !m.forecast.available) expect(m.forecast.refusal).toBe('unprojected')
  })
})

function screen(forecast: unknown) {
  return {
    league: { id: 'l1', name: 'KBFL', platform: 'espn', format: 'dynasty', sourceLink: null },
    team: { available: false, reason: 'n/a' },
    starters: { available: false, reason: 'n/a' },
    bench: { available: false, reason: 'n/a' },
    ir: { available: false, reason: 'n/a' },
    taxi: { available: false, reason: 'n/a' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: {
      available: true,
      data: {
        seasonYear: 2026, week: 4, bye: false, unpricedReason: null,
        you: { rosterId: '3', teamName: 'BroVengers', managerName: 'me', avatarUrl: null, projected: 35, projectedFrom: 2, starterCount: 2 },
        opponent: { rosterId: '7', teamName: 'Tigers', managerName: 'them', avatarUrl: null, projected: 22, projectedFrom: 2, starterCount: 2 },
        forecast,
      },
    },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
  } as unknown as MyTeamData
}

describe('the win chance, on the top number (2026-11-14)', () => {
  it('says the percentage once, beside both projections, and opens Matchup', () => {
    const { container } = render(
      <MyTeam data={screen({ available: true, pWin: 0.734, projectedMargin: 12.96, confidence: 'MEDIUM', detail: '' })} />,
    )
    const chip = container.querySelector('[data-chip=projected]')!
    expect(chip.querySelector('b')?.textContent).toBe('35.0 vs 22.0')
    expect(chip.querySelector('span')?.textContent).toBe('Projected · 73% to win')
    expect(chip.getAttribute('href')).toMatch(/^\/core\/matchup\?league=/)
    // No second card repeating the numbers with its own margin.
    expect(container.querySelector('.af-mt-mu-win')).toBeNull()
    expect(container.textContent).not.toContain('projected margin')
  })

  it('shows no percentage when the forecast declines', () => {
    const { container } = render(<MyTeam data={screen({ available: false, refusal: 'unattributed', reason: UNATTRIBUTED_REASON })} />)
    const chip = container.querySelector('[data-chip=projected]')!
    expect(chip.querySelector('span')?.textContent).toBe('Projected, you vs them')
    expect(chip.textContent).not.toMatch(/\d+%/)
  })
})
