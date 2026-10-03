import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A guillotine league's rail week and cut line (2026-10-03).
 *
 * The rail took the earliest week with a 0–0 row as "this week". A chopped team keeps a 0–0 row in
 * every week after its chop, so every guillotine league sat on week 2 forever, and the standing
 * ranked a field that still held the chopped teams — whose 0 became the cut line.
 *
 * The fixture is the measured shape: 18 rosters; the lowest scorer of weeks 1, 2 and 3 chopped after
 * each (rosters 2, 7, 15), each 0–0 from the following week; week 4 in progress; provider
 * `current_week` 4. A head-to-head league rides alongside as the control.
 */

type Row = { leagueId: string; seasonYear: number; week: number; rosterId: string; matchupId: number; pointsFor: number; pointsAgainst: number; updatedAt: Date }

const AT = new Date('2026-10-03T02:00:00Z')
const rosters = Array.from({ length: 18 }, (_, i) => String(i + 1))
const chopAfter: Record<string, number> = { '2': 1, '7': 2, '15': 3 }
const lowestIn: Record<number, string> = { 1: '2', 2: '7', 3: '15' }

function guillotineRows(): Row[] {
  const out: Row[] = []
  for (let week = 1; week <= 5; week++) {
    for (const r of rosters) {
      const chopped = chopAfter[r] != null && week > chopAfter[r]!
      let points = 0
      if (!chopped && week <= 3) points = lowestIn[week] === r ? 40 : 80 + Number(r)
      // Week 4 in progress: some live teams have points, the rest have not played yet.
      if (!chopped && week === 4) points = Number(r) % 2 === 0 ? 20 + Number(r) : 0
      if (r === '1' && week === 4) points = 95 // you
      out.push({ leagueId: 'G', seasonYear: 2026, week, rosterId: r, matchupId: Number(r), pointsFor: points, pointsAgainst: 0, updatedAt: AT })
    }
  }
  return out
}

function h2hRows(): Row[] {
  return [
    { leagueId: 'H', seasonYear: 2026, week: 3, rosterId: '1', matchupId: 1, pointsFor: 100, pointsAgainst: 90, updatedAt: AT },
    { leagueId: 'H', seasonYear: 2026, week: 3, rosterId: '2', matchupId: 1, pointsFor: 90, pointsAgainst: 100, updatedAt: AT },
    { leagueId: 'H', seasonYear: 2026, week: 4, rosterId: '1', matchupId: 1, pointsFor: 0, pointsAgainst: 0, updatedAt: AT },
    { leagueId: 'H', seasonYear: 2026, week: 4, rosterId: '2', matchupId: 1, pointsFor: 0, pointsAgainst: 0, updatedAt: AT },
  ]
}

const db = vi.hoisted(() => ({ rows: [] as unknown[], stated: [] as unknown[], queryRaw: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: {
      groupBy: async () => [{ leagueId: 'G', _max: { seasonYear: 2026 } }, { leagueId: 'H', _max: { seasonYear: 2026 } }],
      findMany: async () => db.rows,
    },
    leagueTeam: {
      findMany: async () => [
        ...rosters.map((r) => ({ externalId: r, teamName: `G${r}`, ownerName: null, avatarUrl: null, claimedByUserId: r === '1' ? 'user' : null, platformUserId: `g-${r}`, league: { id: 'AF-G', platform: 'sleeper', platformLeagueId: 'G' } })),
        { externalId: '1', teamName: 'Mine', ownerName: null, avatarUrl: null, claimedByUserId: 'user', platformUserId: 'h-1', league: { id: 'AF-H', platform: 'sleeper', platformLeagueId: 'H' } },
        { externalId: '2', teamName: 'Theirs', ownerName: null, avatarUrl: null, claimedByUserId: null, platformUserId: 'h-2', league: { id: 'AF-H', platform: 'sleeper', platformLeagueId: 'H' } },
      ],
    },
    matchupFact: { findMany: async () => [] },
    $queryRaw: db.queryRaw,
    $queryRawUnsafe: async () => [],
  },
}))

import { choppedBefore, getRailMatchups } from '@/lib/core-app/railMatchups'

beforeEach(() => {
  db.rows = [...guillotineRows(), ...h2hRows()]
  db.queryRaw.mockReset()
  db.queryRaw.mockResolvedValue([{ id: 'AF-G', platformLeagueId: 'G', season: 2026, status: 'in_season', sport: 'NFL', settings: { leg: '4' } }])
})

const call = () =>
  getRailMatchups('user', [
    { id: 'AF-G', platformLeagueId: 'G', elimination: true },
    { id: 'AF-H', platformLeagueId: 'H' },
  ])

describe('choppedBefore', () => {
  it('finds the three chopped teams from the score rows alone', () => {
    expect([...choppedBefore(guillotineRows(), 4)].sort()).toEqual(['15', '2', '7'])
  })
  it('never counts the week in progress, where live teams sit at 0 before they play', () => {
    expect([...choppedBefore(guillotineRows(), 4)]).not.toContain('3')
  })
  it('chops nobody on a tie at the bottom, rather than guess the provider’s tiebreak', () => {
    const rows = [
      { week: 1, rosterId: 'a', pointsFor: 50 },
      { week: 1, rosterId: 'b', pointsFor: 50 },
      { week: 1, rosterId: 'c', pointsFor: 90 },
    ]
    expect(choppedBefore(rows, 2).size).toBe(0)
  })
})

describe('the rail in a guillotine league', () => {
  it('is on the provider’s week 4, not stuck on week 2', async () => {
    const result = await call()
    expect(result.byLeague['AF-G']?.week).toBe(4)
  })

  it('ranks you in the LIVE field of 15, against a live team’s score — not a chopped team’s 0', async () => {
    const standing = (await call()).byLeague['AF-G']?.standing
    expect(standing?.outOf).toBe(15)
    // Every live team at 0 this week has simply not played yet; the cut line is still 0, but no
    // chopped team is in the field to make it so.
    expect(standing?.rank).toBe(1)
  })

  it('falls back to the row rule when the provider states no week (the old behaviour, unchanged)', async () => {
    db.queryRaw.mockResolvedValue([])
    expect((await call()).byLeague['AF-G']?.week).toBe(2)
  })

  it('leaves a head-to-head league on the row rule (the control)', async () => {
    const result = await call()
    expect(result.byLeague['AF-H']?.week).toBe(4)
    expect(result.byLeague['AF-H']?.opponentTeam).toBe('Theirs')
    // Only the elimination league was asked for its stated week.
    const asked = JSON.stringify(db.queryRaw.mock.calls)
    expect(asked).toContain('G')
    expect(asked).not.toContain('"H"')
  })
})
