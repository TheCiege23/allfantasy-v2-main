// @vitest-environment node
/**
 * A tied meeting is a tie in the dashboard / League Home rival records (2026-10-03).
 *
 * `getRivalRecords` counted every meeting you did not win as a LOSS: a dead heat
 * added to `losses`, read "beat you by 0.0" as the last result, and — because the
 * list is ranked by losses — pushed a manager you have only ever tied to the top
 * of "who actually beats you". Same bug #1998 fixed in weekBoard.ts's readers.
 */
import { expect, it, vi } from 'vitest'

/*
 * Me = roster 1. Each week I play one opponent; nothing else in the league
 * matters to my record. Chronological order is the order below.
 *   Even   (2): tie, tie, tie                → 0-0-3, never beat me
 *   Beater (3): loss                         → 0-1
 *   Mixed  (4): win, loss, tie (last)        → 1-1-1, last result a tie
 */
const meetings: Array<[week: number, opp: string, mine: number, theirs: number]> = [
  [1, '2', 100, 100],
  [2, '3', 100, 110],
  [3, '2', 100, 100],
  [4, '4', 100, 90],
  [5, '4', 90, 100],
  [6, '4', 100, 100],
  [7, '2', 100, 100],
]

vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({
  // No metadata → no "is this week final" filter; every row below is a completed week.
  readLeagueWeekMetadata: vi.fn(async () => []),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: vi.fn(async () => [{ id: 'L', platformLeagueId: 'P' }]) },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { leagueId: 'L', externalId: '1', claimedByUserId: 'U', ownerName: 'Me' },
        { leagueId: 'L', externalId: '2', ownerName: 'Even' },
        { leagueId: 'L', externalId: '3', ownerName: 'Beater' },
        { leagueId: 'L', externalId: '4', ownerName: 'Mixed' },
      ]),
    },
    weeklyMatchup: {
      findMany: vi.fn(async () =>
        meetings.flatMap(([week, opp, mine, theirs]) => [
          { leagueId: 'P', seasonYear: 2025, week, rosterId: '1', matchupId: 1, pointsFor: mine },
          { leagueId: 'P', seasonYear: 2025, week, rosterId: opp, matchupId: 1, pointsFor: theirs },
        ]),
      ),
    },
  },
}))

import { getRivalRecords } from '@/lib/core-app/dash3aPanels'

async function rows() {
  const result = await getRivalRecords('U', ['L'])
  if (!result.available) throw new Error(result.reason)
  return result.data.rows
}

it('counts a level meeting as a tie, not a loss — and meetings include it', async () => {
  const mixed = (await rows()).find((r) => r.name === 'Mixed')
  expect(mixed).toMatchObject({ wins: 1, losses: 1, ties: 1, meetings: 3 })
})

it('a manager you have only tied has zero losses, not three', async () => {
  const even = (await rows()).find((r) => r.name === 'Even')
  expect(even).toMatchObject({ wins: 0, losses: 0, ties: 3, meetings: 3 })
})

it('a tied last meeting reads "a tie", never "beat you by 0.0"', async () => {
  const mixed = (await rows()).find((r) => r.name === 'Mixed')
  expect(mixed?.lastResult).toBe('a tie')
})

it('ranks by losses, then meetings — ties do not make someone a rival', async () => {
  // Mixed and Beater each beat you once; Mixed has more meetings (ties count), so it leads.
  // Even never beat you, so it is last despite three meetings.
  expect((await rows()).map((r) => r.name)).toEqual(['Mixed', 'Beater', 'Even'])
})

it('a series without ties reads exactly as before', async () => {
  const beater = (await rows()).find((r) => r.name === 'Beater')
  expect(beater).toMatchObject({ wins: 0, losses: 1, ties: 0, meetings: 1, lastResult: 'beat you by 10.0' })
})
