/**
 * All-time standings. What must hold beyond "the totals add up":
 *   - a manager is one person across seasons by OWNER ID — a rename does not split them, and two
 *     managers sharing a name are not merged (the old name-keyed aggregator did both);
 *   - titles come from the imported flags OR the native season row's champion, never from wins;
 *   - the season in progress counts toward the record, never toward a title;
 *   - moves/messages are AllFantasy activity, mapped through a claimed team onto the host's owner id,
 *     and "unknown" (null) for an imported league with none on file.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAllTimeStandingsByOwner, managerKeyOf } from '@/lib/league/allTimeStandings'

const h = vi.hoisted(() => ({
  platform: 'allfantasy',
  archived: [] as Array<Record<string, unknown>>,
  current: null as null | { season: number; rosters: Array<Record<string, unknown>> },
  teams: [] as Array<{ claimedByUserId: string | null; platformUserId: string | null }>,
  rosters: [] as Array<{ id: string; platformUserId: string | null }>,
  waivers: [] as Array<{ rosterId: string; _count: { _all: number } }>,
  trades: [] as Array<{ proposerRosterId: string; receiverRosterId: string }>,
  chat: [] as Array<{ userId: string; _count: { _all: number } }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ platform: h.platform, season: 2026, teams: h.teams })) },
    leagueSeason: { findMany: vi.fn(async () => h.archived) },
    redraftSeason: { findFirst: vi.fn(async () => h.current) },
    roster: { findMany: vi.fn(async () => h.rosters) },
    redraftRoster: { findMany: vi.fn(async () => []) },
    waiverTransaction: { groupBy: vi.fn(async () => h.waivers) },
    afLeagueTrade: { findMany: vi.fn(async () => h.trades) },
    redraftTradeProposal: { findMany: vi.fn(async () => []) },
    leagueChatMessage: { groupBy: vi.fn(async () => h.chat) },
  },
}))

import { loadAllTimeStandings } from '@/lib/league/allTimeStandingsServer'

const imported = (ownerId: string, managerName: string, w: number, l: number, extra: Record<string, unknown> = {}) => ({
  rosterId: ownerId,
  ownerId,
  managerName,
  wins: w,
  losses: l,
  ties: 0,
  pointsFor: w * 100,
  pointsAgainst: l * 100,
  ...extra,
})

describe('computeAllTimeStandingsByOwner', () => {
  it('keys by owner id: a rename stays one manager, a shared name stays two', () => {
    const rows = computeAllTimeStandingsByOwner({
      seasons: [
        { season: 2024, teamRecords: [imported('u1', 'Sam', 8, 6), imported('u2', 'Alex', 6, 8)] },
        { season: 2025, teamRecords: [imported('u1', 'Sammy', 10, 4), imported('u3', 'Alex', 7, 7)] },
      ],
    })
    expect(rows.map((r) => [r.managerKey, r.managerName, r.seasonsPlayed])).toEqual([
      ['u1', 'Sammy', 2], // newest name shown
      ['u3', 'Alex', 1],
      ['u2', 'Alex', 1],
    ])
    expect(rows[0]).toMatchObject({ totalWins: 18, totalLosses: 10, yearRange: '2024–2025', totalPoints: 1800, totalPointsAgainst: 1000 })
  })

  it('titles: imported flags, or the native season row — never estimated from wins', () => {
    const rows = computeAllTimeStandingsByOwner({
      seasons: [
        { season: 2024, teamRecords: [imported('u1', 'Sam', 12, 2), imported('u2', 'Alex', 5, 9, { isChampion: true, isRunnerUp: false })] },
        {
          season: 2025,
          championTeamId: 'team-alex',
          runnerUpName: 'Sam FC',
          teamRecords: [
            { managerUserId: 'u1', managerName: 'Sam', franchiseName: 'Sam FC', franchiseId: 'team-sam', rank: 2, wins: 11, losses: 3, ties: 0, pointsFor: 1, pointsAgainst: 1 },
            { managerUserId: 'u2', managerName: 'Alex', franchiseName: 'Alex FC', franchiseId: 'team-alex', rank: 1, wins: 6, losses: 8, ties: 0, pointsFor: 1, pointsAgainst: 1 },
          ],
        },
      ],
    })
    const byKey = Object.fromEntries(rows.map((r) => [r.managerKey, r]))
    expect(byKey.u2).toMatchObject({ championships: 2, bestFinish: '1st' })
    expect(byKey.u1).toMatchObject({ championships: 0, runnerUps: 1, bestFinish: '2nd' })
  })

  it('the season in progress counts toward the record but never a title; a tie is half a win', () => {
    const rows = computeAllTimeStandingsByOwner({
      seasons: [{ season: 2026, inProgress: true, teamRecords: [imported('u1', 'Sam', 3, 0, { ties: 1, isChampion: true })] }],
    })
    expect(rows[0]).toMatchObject({ totalWins: 3, totalTies: 1, championships: 0, bestFinish: '—', winPct: 3.5 / 4 })
  })

  it('a record with no owner id falls back to its name; aliases fold one id onto another', () => {
    expect(managerKeyOf({ managerName: ' Sam ' })).toBe('name:sam')
    expect(managerKeyOf({ managerUserId: 'af-1' }, new Map([['af-1', 'sleeper-1']]))).toBe('sleeper-1')
  })

  it('moves and messages: a number when known, null when the league has no activity on file', () => {
    const seasons = [{ season: 2025, teamRecords: [imported('u1', 'Sam', 1, 0)] }]
    expect(computeAllTimeStandingsByOwner({ seasons })[0]).toMatchObject({ moves: null, messages: null })
    expect(computeAllTimeStandingsByOwner({ seasons, moves: new Map([['u1', 4]]), messages: new Map() })[0]).toMatchObject({ moves: 4, messages: 0 })
  })
})

describe('loadAllTimeStandings', () => {
  beforeEach(() => {
    h.platform = 'allfantasy'
    h.archived = [{ season: 2025, championTeamId: null, championName: 'Sam FC', runnerUpName: null, teamRecords: [{ managerUserId: 'u1', managerName: 'Sam', franchiseName: 'Sam FC', wins: 10, losses: 4, ties: 0, pointsFor: 1500, pointsAgainst: 1300 }] }]
    h.current = { season: 2026, rosters: [{ id: 'rr1', ownerId: 'u1', ownerName: 'Sam', teamName: 'Sam FC', wins: 3, losses: 1, ties: 0, pointsFor: 400, pointsAgainst: 350 }] }
    h.teams = []
    h.rosters = [{ id: 'R1', platformUserId: 'u1' }]
    h.waivers = [{ rosterId: 'R1', _count: { _all: 5 } }]
    h.trades = [{ proposerRosterId: 'R1', receiverRosterId: 'R2' }]
    h.chat = [{ userId: 'u1', _count: { _all: 12 } }]
  })

  it('native: archived seasons plus the one being played, with moves and messages', async () => {
    const [row] = await loadAllTimeStandings('L1')
    expect(row).toMatchObject({ managerKey: 'u1', seasonsPlayed: 2, totalWins: 13, totalLosses: 5, championships: 1, moves: 6, messages: 12 })
  })

  it('an archived current season is not counted twice', async () => {
    h.current = { season: 2025, rosters: h.current!.rosters }
    const [row] = await loadAllTimeStandings('L1')
    expect(row).toMatchObject({ seasonsPlayed: 1, totalWins: 10 })
  })

  it('imported: an AllFantasy user is matched to their host owner id through the claimed team', async () => {
    h.platform = 'sleeper'
    h.current = null
    h.archived = [{ season: 2024, championTeamId: null, championName: null, runnerUpName: null, teamRecords: [imported('slp-9', 'Sam', 9, 5)] }]
    h.teams = [{ claimedByUserId: 'af-1', platformUserId: 'slp-9' }]
    h.rosters = [{ id: 'R1', platformUserId: 'slp-9' }]
    h.waivers = []
    h.trades = []
    h.chat = [{ userId: 'af-1', _count: { _all: 7 } }]
    const [row] = await loadAllTimeStandings('L1')
    expect(row).toMatchObject({ managerKey: 'slp-9', messages: 7, moves: 0 })
  })

  it('imported with no AllFantasy activity: moves and messages are unknown, not zero', async () => {
    h.platform = 'sleeper'
    h.current = null
    h.archived = [{ season: 2024, championTeamId: null, championName: null, runnerUpName: null, teamRecords: [imported('slp-9', 'Sam', 9, 5)] }]
    h.waivers = []
    h.trades = []
    h.chat = []
    const [row] = await loadAllTimeStandings('L1')
    expect(row).toMatchObject({ moves: null, messages: null })
  })
})
