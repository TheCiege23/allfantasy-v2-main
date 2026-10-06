// @vitest-environment node
/**
 * A tied head-to-head meeting is a TIE, not a loss (2026-10-03).
 *
 * Both rivalry readers in `lib/core-app/weekBoard.ts` — `getRivalryRadar` and the
 * league week board's `rivalry` field — counted every meeting that was not a win
 * as a loss, so a 1-1-1 series rendered as 1-2, landed in "They own you", and its
 * closest meeting (a dead heat) read "you lost by 0.0".
 *
 * ⚠ THE PRISMA MOCK HONOURS `select`, copied from `week-board-avatars.test.ts`, so
 * the loader sees only the columns it actually asks for.
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
const teamRows: Row[] = []

const mocks = vi.hoisted(() => ({
  weeklyFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  factFindMany: vi.fn(async () => []),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: mocks.weeklyFindMany },
    leagueTeam: { findMany: mocks.teamFindMany },
    matchupFact: { findMany: mocks.factFindMany },
  },
}))
vi.mock('@/lib/core-app/seasonPhase', () => ({
  getFirstStatedKickoff: vi.fn(async () => null),
}))

import { getRivalryRadar, getWeekBoard } from '@/lib/core-app/weekBoard'

/** You are roster 1, the opponent roster 2. `mine`/`theirs` are the two scores. */
function meeting(week: number, mine: number, theirs: number): Row[] {
  const base = { leagueId: 'P1', seasonYear: 2026, week, matchupId: 1, win: 0 }
  return [
    { ...base, rosterId: '1', pointsFor: mine, pointsAgainst: theirs },
    { ...base, rosterId: '2', pointsFor: theirs, pointsAgainst: mine },
  ]
}

function team(externalId: string, teamName: string, claimedByUserId: string | null = null): Row {
  return {
    externalId,
    teamName,
    ownerName: `${teamName} owner`,
    avatarUrl: null,
    claimedByUserId,
    league: { platformLeagueId: 'P1', platform: 'sleeper' },
  }
}

const LEAGUES = [
  {
    id: 'L1',
    name: 'Tie League',
    platform: 'sleeper',
    platformLeagueId: 'P1',
    logoUrl: null,
    avatarUrl: null,
    leagueType: 'redraft',
  },
]

function seed(...weeks: Row[][]) {
  matchupRows.length = 0
  for (const w of weeks) matchupRows.push(...w)
}

beforeEach(() => {
  teamRows.length = 0
  teamRows.push(team('1', 'Mine', 'u1'), team('2', 'Rival'))
  // One win, one loss, one dead heat, then this week's unplayed fixture.
  seed(meeting(1, 100, 90), meeting(2, 80, 95), meeting(3, 88.5, 88.5), meeting(4, 0, 0))

  mocks.weeklyFindMany.mockReset()
  mocks.teamFindMany.mockReset()
  mocks.weeklyFindMany.mockImplementation(async (args: { where: { leagueId: { in: string[] } }; select: Row }) =>
    matchupRows
      .filter((r) => args.where.leagueId.in.includes(r.leagueId as string))
      .map((r) => pick(r, args.select as Record<string, unknown>)),
  )
  mocks.teamFindMany.mockImplementation(
    async (args: { where: { claimedByUserId?: string }; select: Row }) =>
      teamRows
        .filter((t) => args.where.claimedByUserId == null || t.claimedByUserId === args.where.claimedByUserId)
        .map((t) => pick(t, args.select as Record<string, unknown>)),
  )
})

function allCards(radar: Awaited<ReturnType<typeof getRivalryRadar>>) {
  return [...radar.theyOwnYou, ...radar.youOwnThem, ...radar.even]
}

describe('getRivalryRadar — ties', () => {
  it('keeps a scored current-period opponent on the schedule without a pregame probability', async () => {
    seed(meeting(1,100,90),meeting(2,80,95),meeting(3,88.5,88.5),meeting(4,12,20))
    const card = allCards(await getRivalryRadar('u1',LEAGUES)).find(c=>c.opponent.rosterId==='2')!
    expect(card.thisWeek).toEqual({status:'live',winProbability:null,projectedMargin:null})
    expect(card.series.meetings).toBe(3)
  })
  it('counts a tied meeting as a tie, not a loss', async () => {
    const radar = await getRivalryRadar('u1', LEAGUES)
    const card = allCards(radar).find((c) => c.opponent.rosterId === '2')
    expect(card).toBeDefined()
    expect(card!.series).toEqual({ wins: 1, losses: 1, ties: 1, meetings: 3 })
  })

  it('files a 1-1-1 series as level, not as one the opponent owns', async () => {
    const radar = await getRivalryRadar('u1', LEAGUES)
    // The fixture projects you to LOSE this week, so before the fix the 1-2
    // misread sent this card to "They own you". Level series go to `even`.
    const card = allCards(radar).find((c) => c.opponent.rosterId === '2')!
    expect(card.thisWeek?.winProbability).not.toBeNull()
    expect(radar.theyOwnYou).toHaveLength(0)
    expect(radar.even.map((c) => c.opponent.rosterId)).toEqual(['2'])
  })

  it('marks a tied closest meeting as tied, not lost', async () => {
    const radar = await getRivalryRadar('u1', LEAGUES)
    const card = allCards(radar).find((c) => c.opponent.rosterId === '2')!
    expect(card.closest).toEqual({ season: 2026, week: 3, margin: 0, won: false, tied: true })
  })

  it('leaves a series with no ties reading exactly as before', async () => {
    seed(meeting(1, 100, 90), meeting(2, 80, 95), meeting(3, 70, 95), meeting(4, 0, 0))
    const radar = await getRivalryRadar('u1', LEAGUES)
    const card = allCards(radar).find((c) => c.opponent.rosterId === '2')!
    expect(card.series).toEqual({ wins: 1, losses: 2, ties: 0, meetings: 3 })
    expect(card.closest).toEqual({ season: 2026, week: 1, margin: 10, won: true, tied: false })
    expect(radar.theyOwnYou.map((c) => c.opponent.rosterId)).toEqual(['2'])
  })
})

describe('getWeekBoard — league rivalry ties', () => {
  it("counts a tied meeting as a tie in this week's all-time record", async () => {
    const board = await getWeekBoard('u1', LEAGUES, 'L1')
    const lb = board.leagueBoard!
    expect(lb.yours?.opponent.rosterId).toBe('2')
    expect(lb.rivalry).toMatchObject({ wins: 1, losses: 1, ties: 1, meetings: 3 })
  })
})
