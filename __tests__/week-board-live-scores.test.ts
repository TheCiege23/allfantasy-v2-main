// @vitest-environment node
/**
 * The week card carries THIS week's actual points once either side has scored.
 *
 * Measured on production 2026-09-28 (Monday of week 3): "Your week" ranked on the mean of prior
 * weeks ("+29.6 · 78% to win") while the Matchup screen had the same league at +68.0 on the
 * scoreboard. The loader has the week's points in hand; it now hands them to the board.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

function pick(row: Row, select: Record<string, unknown>): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(select)) {
    if (v === true) out[k] = row[k]
    else if (v && typeof v === 'object' && 'select' in (v as Row)) {
      const rel = row[k] as Row | null | undefined
      out[k] = rel ? pick(rel, (v as { select: Record<string, unknown> }).select) : rel
    }
  }
  return out
}

const matchupRows: Row[] = []
const mocks = vi.hoisted(() => ({
  weeklyFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  factFindMany: vi.fn(async () => []),
  metadata: vi.fn(async (): Promise<unknown[]> => []),
  gamesFindMany: vi.fn(async (): Promise<unknown[]> => []),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: mocks.weeklyFindMany },
    leagueTeam: { findMany: mocks.teamFindMany },
    matchupFact: { findMany: mocks.factFindMany },
    sportsGame: { findMany: mocks.gamesFindMany },
  },
}))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: mocks.metadata }))
vi.mock('@/lib/core-app/seasonPhase', () => ({ getFirstStatedKickoff: vi.fn(async () => null) }))

import { getWeekBoard } from '@/lib/core-app/weekBoard'

function mrow(week: number, rosterId: string, pointsFor: number, pointsAgainst: number): Row {
  return { leagueId: 'P1', seasonYear: 2026, week, rosterId, matchupId: 1, pointsFor, pointsAgainst, win: pointsFor > pointsAgainst ? 1 : 0 }
}

const LEAGUES = [
  { id: 'L1', name: 'Cream Bowl', platform: 'sleeper', platformLeagueId: 'P1', logoUrl: null, avatarUrl: null, leagueType: 'redraft' },
]

beforeEach(() => {
  matchupRows.length = 0
  mocks.weeklyFindMany.mockReset()
  mocks.teamFindMany.mockReset()
  mocks.metadata.mockReset().mockResolvedValue([])
  mocks.gamesFindMany.mockReset().mockResolvedValue([])
  mocks.weeklyFindMany.mockImplementation(async (args: { where: { leagueId: { in: string[] } }; select: Row }) =>
    matchupRows
      .filter((r) => args.where.leagueId.in.includes(r.leagueId as string))
      .map((r) => pick(r, args.select as Record<string, unknown>)),
  )
  mocks.teamFindMany.mockImplementation(async (args: { where: { claimedByUserId?: string }; select: Row }) =>
    [
      { externalId: '1', teamName: 'Mine', ownerName: 'me', avatarUrl: null, claimedByUserId: 'u1', league: { platformLeagueId: 'P1', platform: 'sleeper' } },
      { externalId: '2', teamName: 'Them', ownerName: 'them', avatarUrl: null, claimedByUserId: null, league: { platformLeagueId: 'P1', platform: 'sleeper' } },
    ]
      .filter((t) => args.where.claimedByUserId == null || t.claimedByUserId === args.where.claimedByUserId)
      .map((t) => pick(t as Row, args.select as Record<string, unknown>)),
  )
})

describe('getWeekBoard — this week has points', () => {
  it('attaches the scoreboard margin to the current-week card', async () => {
    matchupRows.push(
      mrow(1, '1', 110, 100), mrow(1, '2', 100, 110),
      mrow(2, '1', 115, 90), mrow(2, '2', 90, 115),
      mrow(3, '1', 168, 100), mrow(3, '2', 100, 168),
    )
    const board = await getWeekBoard('u1', LEAGUES)
    const card = [...board.coinFlips, ...board.leaning, ...board.unprojected].find((m) => m.leagueId === 'L1')
    expect(card?.week).toBe(3)
    expect(card?.live).toMatchObject({ you: 168, them: 100, margin: 68 })
  })

  it('carries no live score before anybody has put up a point', async () => {
    matchupRows.push(
      mrow(1, '1', 110, 100), mrow(1, '2', 100, 110),
      mrow(2, '1', 115, 90), mrow(2, '2', 90, 115),
      mrow(3, '1', 0, 0), mrow(3, '2', 0, 0),
    )
    const board = await getWeekBoard('u1', LEAGUES)
    const card = [...board.coinFlips, ...board.leaning, ...board.unprojected].find((m) => m.leagueId === 'L1')
    expect(card?.week).toBe(3)
    expect(card?.live).toBeNull()
  })
})

/*
 * 🛑 THE TUESDAY AFTER A WEEK. Sleeper keeps the league on week 3 until Wednesday, and the board
 * read "final" only from that marker — so on 2026-09-29, every week-3 game final, Your Week said
 * "−40.8 so far" for a game already lost. The NFL schedule is now the second witness.
 */
describe('getWeekBoard — a fully played week the platform has not rolled yet', () => {
  const game = (status: string) => ({
    season: 2026, week: 3, homeTeam: 'CHI', awayTeam: 'PHI', status, seasonType: 'regular',
    startTime: new Date('2026-09-29T00:15:00Z'), fetchedAt: new Date('2026-09-29T14:00:00Z'),
  })
  const card = async () => {
    const board = await getWeekBoard('u1', LEAGUES)
    return [...board.coinFlips, ...board.leaning, ...board.unprojected].find((m) => m.leagueId === 'L1')
  }

  beforeEach(() => {
    matchupRows.push(
      mrow(1, '1', 110, 100), mrow(1, '2', 100, 110),
      mrow(2, '1', 115, 90), mrow(2, '2', 90, 115),
      mrow(3, '1', 98.2, 138.9), mrow(3, '2', 138.9, 98.2),
    )
    mocks.metadata.mockResolvedValue([{ id: 'L1', platformLeagueId: 'P1', season: 2026, status: 'in_season', sport: 'NFL', settings: { leg: 3 } }])
  })

  it('every week-3 game final: the card is a final result, not "so far"', async () => {
    mocks.gamesFindMany.mockResolvedValue([game('final')])
    expect((await card())?.live).toMatchObject({ final: true })
  })

  it('a week-3 game still to play: the card stays live', async () => {
    mocks.gamesFindMany.mockResolvedValue([game('final'), { ...game('scheduled'), homeTeam: 'BUF', awayTeam: 'MIA' }])
    expect((await card())?.live).toMatchObject({ final: false })
  })
})
