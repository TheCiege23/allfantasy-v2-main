// @vitest-environment node
/**
 * getWeekBoard attaches the elimination settle verdict to each scored guillotine card. The prisma
 * harness is copied from week-board-live-scores.test.ts; the settle loader is mocked, because its
 * own reads are covered by elimination-settle-loader.test.ts.
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
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: mocks.weeklyFindMany },
    leagueTeam: { findMany: mocks.teamFindMany },
    matchupFact: { findMany: mocks.factFindMany },
  },
}))
vi.mock('@/lib/core-app/seasonPhase', () => ({ getFirstStatedKickoff: vi.fn(async () => null) }))

const settleMock = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/core-app/eliminationSettleLoader', () => ({ loadEliminationSettle: settleMock.load }))

import { getWeekBoard } from '@/lib/core-app/weekBoard'

/*
 * The board reads the settle verdict once for each scored elimination week, so the week board,
 * Your Week and Chimmy all say the same thing (2026-09-28: "+41.2 clear" for a user who could
 * not be chopped). A guillotine week is "groups of one": every roster its own matchupId, no
 * points against.
 */
function erow(week: number, rosterId: string, pointsFor: number): Row {
  return { leagueId: 'G1', seasonYear: 2026, week, rosterId, matchupId: Number(rosterId), pointsFor, pointsAgainst: 0, win: 0 }
}

const LEAGUES = [
  { id: 'L-g', name: 'Chop Shop', platform: 'sleeper', platformLeagueId: 'G1', logoUrl: null, avatarUrl: null, leagueType: 'guillotine' },
]

beforeEach(() => {
  matchupRows.length = 0
  mocks.weeklyFindMany.mockReset()
  mocks.teamFindMany.mockReset()
  settleMock.load.mockReset()
  mocks.weeklyFindMany.mockImplementation(async (args: { where: { leagueId: { in: string[] } }; select: Row }) =>
    matchupRows
      .filter((r) => args.where.leagueId.in.includes(r.leagueId as string))
      .map((r) => pick(r, args.select as Record<string, unknown>)),
  )
  mocks.teamFindMany.mockImplementation(async (args: { where: { claimedByUserId?: string }; select: Row }) =>
    ['1', '2', '3'].map((id) => ({
      externalId: id, teamName: `T${id}`, ownerName: `o${id}`, avatarUrl: null, claimedByUserId: id === '1' ? 'u1' : null,
      league: { platformLeagueId: 'G1', platform: 'sleeper' },
    }))
      .filter((t) => args.where.claimedByUserId == null || t.claimedByUserId === args.where.claimedByUserId)
      .map((t) => pick(t as Row, args.select as Record<string, unknown>)),
  )
})

describe('getWeekBoard — elimination settle', () => {
  it('reads the verdict for a scored elimination week and attaches it to the card', async () => {
    matchupRows.push(erow(3, '1', 87.74), erow(3, '2', 46.54), erow(3, '3', 60))
    settleMock.load.mockResolvedValue({ verdict: 'safe', finishedBelow: 2, chops: 1 })
    const board = await getWeekBoard('u1', LEAGUES)
    expect(board.eliminationWeeks).toHaveLength(1)
    expect(board.eliminationWeeks[0].settle).toEqual({ verdict: 'safe', finishedBelow: 2, chops: 1 })
    expect(settleMock.load).toHaveBeenCalledWith({ platformLeagueId: 'G1', season: 2026, week: 3, yourRosterId: '1' })
  })

  it('does not read a week nobody has scored in, and leaves the card unsettled', async () => {
    matchupRows.push(erow(2, '1', 90), erow(2, '2', 80), erow(2, '3', 70), erow(3, '1', 0), erow(3, '2', 0), erow(3, '3', 0))
    const board = await getWeekBoard('u1', LEAGUES)
    const card = board.eliminationWeeks.find((e) => e.leagueId === 'L-g')
    if (card && card.week === 3) {
      expect(card.yourScore).toBeNull()
      expect(card.settle).toBeUndefined()
    }
    expect(settleMock.load).not.toHaveBeenCalledWith(expect.objectContaining({ week: 3 }))
  })
})
