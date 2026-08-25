import { beforeEach, describe, expect, it, vi } from 'vitest'

const { matchupFindMany, teamFindMany } = vi.hoisted(() => ({
  matchupFindMany: vi.fn(),
  teamFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: matchupFindMany },
    leagueTeam: { findMany: teamFindMany },
  },
}))

import { getAllPlayBoard } from '@/lib/core-app/allPlay'

const ARGS = { leagueId: 'af-uuid', platformLeagueId: '998877', seasonYear: 2026 }

/** rosterId, week, own points, opponent points, win flag. */
function row(rosterId: number, week: number, pf: number, pa: number, win: number) {
  return { rosterId, week, pointsFor: pf, pointsAgainst: pa, win }
}

beforeEach(() => {
  matchupFindMany.mockReset()
  teamFindMany.mockResolvedValue([
    { externalId: '1', teamName: 'Unlucky', ownerName: 'a', avatarUrl: null },
    { externalId: '2', teamName: 'Lucky', ownerName: 'b', avatarUrl: null },
    { externalId: '3', teamName: 'Mid', ownerName: 'c', avatarUrl: null },
    { externalId: '4', teamName: 'Bad', ownerName: 'd', avatarUrl: null },
  ])
})

describe('getAllPlayBoard', () => {
  it('⚠ finds the team that scores well and keeps losing', async () => {
    /*
     * The whole point. Roster 1 posts the second-highest score both weeks and
     * loses both, because it drew the top scorer twice. Head-to-head says 0-2;
     * all-play says it beats two of three teams every week.
     */
    matchupFindMany.mockResolvedValue([
      // week 1: 1 (120) loses to 2 (150); 3 (100) beats 4 (90)
      row(1, 1, 120, 150, 0), row(2, 1, 150, 120, 1), row(3, 1, 100, 90, 1), row(4, 1, 90, 100, 0),
      // week 2: 1 (130) loses to 2 (140); 3 (95) beats 4 (80)
      row(1, 2, 130, 140, 0), row(2, 2, 140, 130, 1), row(3, 2, 95, 80, 1), row(4, 2, 80, 95, 0),
    ])

    const b = await getAllPlayBoard(ARGS)
    const unlucky = b!.rows.find((r) => r.rosterId === 1)!
    expect(unlucky.wins).toBe(0)
    expect(unlucky.losses).toBe(2)
    // Beat 2 of the other 3 each week, lost to 1.
    expect(unlucky.allPlayWins).toBe(4)
    expect(unlucky.allPlayLosses).toBe(2)
    // And the luck number says so out loud: worse record than they played.
    expect(unlucky.luckWins).toBeLessThan(0)
  })

  it('gives the genuinely lucky team a positive luck number', async () => {
    matchupFindMany.mockResolvedValue([
      // Roster 4 wins with the LOWEST score, because it drew the second lowest.
      row(1, 1, 150, 140, 1), row(2, 1, 140, 150, 0), row(3, 1, 80, 90, 0), row(4, 1, 90, 80, 1),
    ])
    const b = await getAllPlayBoard(ARGS)
    const lucky = b!.rows.find((r) => r.rosterId === 4)!
    expect(lucky.wins).toBe(1)
    // Beat only one of three on the all-play board.
    expect(lucky.allPlayWins).toBe(1)
    expect(lucky.luckWins).toBeGreaterThan(0)
  })

  it('⚠ ignores unplayed weeks instead of counting a league of ties', async () => {
    /*
     * Sync bootstraps every week at 0-0. Counting those hands every team a pile
     * of all-play ties and drags every record to .500 — flattening the exact
     * signal this exists to measure.
     */
    matchupFindMany.mockResolvedValue([
      row(1, 1, 120, 150, 0), row(2, 1, 150, 120, 1), row(3, 1, 100, 90, 1), row(4, 1, 90, 100, 0),
      // Weeks 2-18 bootstrapped, nobody scored.
      ...[2, 3, 4].flatMap((w) => [row(1, w, 0, 0, 0), row(2, w, 0, 0, 0), row(3, w, 0, 0, 0), row(4, w, 0, 0, 0)]),
    ])
    const b = await getAllPlayBoard(ARGS)
    expect(b!.weeksCounted).toBe(1)
    const r1 = b!.rows.find((r) => r.rosterId === 1)!
    expect(r1.allPlayTies).toBe(0)
    expect(r1.allPlayWins + r1.allPlayLosses).toBe(3)
  })

  it('excludes a team from its own all-play comparison', async () => {
    // n-1 comparisons, not n. A team cannot beat itself, and counting it would
    // add a guaranteed tie to everyone and flatten the spread.
    matchupFindMany.mockResolvedValue([
      row(1, 1, 120, 150, 0), row(2, 1, 150, 120, 1), row(3, 1, 100, 90, 1), row(4, 1, 90, 100, 0),
    ])
    const b = await getAllPlayBoard(ARGS)
    for (const r of b!.rows) {
      expect(r.allPlayWins + r.allPlayLosses + r.allPlayTies).toBe(3)
    }
  })

  it('ranks by all-play, so the standings-leader is not automatically first', async () => {
    matchupFindMany.mockResolvedValue([
      row(1, 1, 150, 140, 1), row(2, 1, 140, 150, 0), row(3, 1, 80, 70, 1), row(4, 1, 70, 80, 0),
    ])
    const b = await getAllPlayBoard(ARGS)
    // Roster 3 is 1-0 like roster 1, but scored 80 to 150.
    expect(b!.rows[0].rosterId).toBe(1)
    expect(b!.rows.find((r) => r.rosterId === 3)!.powerRank).toBeGreaterThan(1)
  })

  it('⚠ reports NO movement rather than zero in the first scored week', async () => {
    /*
     * "Unchanged" and "never ranked before" are different facts, and an arrow
     * that says unchanged for a team with no history is an invented one.
     */
    matchupFindMany.mockResolvedValue([
      row(1, 1, 150, 140, 1), row(2, 1, 140, 150, 0), row(3, 1, 80, 70, 1), row(4, 1, 70, 80, 0),
    ])
    const b = await getAllPlayBoard(ARGS)
    for (const r of b!.rows) expect(r.powerRankChange).toBeNull()
  })

  it('reports real movement once there are two scored weeks', async () => {
    matchupFindMany.mockResolvedValue([
      // Week 1: roster 4 is bottom.
      row(1, 1, 150, 140, 1), row(2, 1, 140, 150, 0), row(3, 1, 100, 70, 1), row(4, 1, 70, 100, 0),
      // Week 2: roster 4 posts the top score by a distance.
      row(1, 2, 60, 200, 0), row(2, 2, 70, 90, 0), row(3, 2, 90, 70, 1), row(4, 2, 200, 60, 1),
    ])
    const b = await getAllPlayBoard(ARGS)
    const climber = b!.rows.find((r) => r.rosterId === 4)!
    expect(climber.powerRankChange).not.toBeNull()
    expect(climber.powerRankChange!).toBeGreaterThan(0)
  })

  it('counts a genuine tie as a tie, not a loss', async () => {
    matchupFindMany.mockResolvedValue([
      row(1, 1, 100, 100, 0), row(2, 1, 100, 100, 0), row(3, 1, 90, 80, 1), row(4, 1, 80, 90, 0),
    ])
    const b = await getAllPlayBoard(ARGS)
    const tied = b!.rows.find((r) => r.rosterId === 1)!
    expect(tied.ties).toBe(1)
    expect(tied.losses).toBe(0)
    // And they tie each other on the all-play board too.
    expect(tied.allPlayTies).toBe(1)
  })

  it('returns null when no week has been played, rather than an empty board', async () => {
    matchupFindMany.mockResolvedValue([row(1, 1, 0, 0, 0), row(2, 1, 0, 0, 0)])
    expect(await getAllPlayBoard(ARGS)).toBeNull()
  })

  it('returns null on the wrong league id space', async () => {
    matchupFindMany.mockResolvedValue([])
    expect(await getAllPlayBoard(ARGS)).toBeNull()
    expect(await getAllPlayBoard({ ...ARGS, platformLeagueId: null })).toBeNull()
  })
})
