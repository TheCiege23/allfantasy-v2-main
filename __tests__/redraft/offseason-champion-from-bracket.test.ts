/**
 * The season archive must credit the team that WON THE BRACKET.
 *
 * `enterRedraftOffseason` built its records in standings order and took `records[0]` as the
 * champion, so `LeagueSeason.championName`, `FranchiseSeason.wonChampionship` and every career
 * rank computed from them credited the regular-season leader. The finished bracket's
 * `structure` already names the champion and each team's finish; these pin that it is read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  seasonCreate: vi.fn(),
  franchiseUpsert: vi.fn(),
  fanout: vi.fn(),
  season: null as any,
}))

vi.mock('@/lib/prisma', () => {
  const tx = {
    leagueSeason: { create: (args: any) => { m.seasonCreate(args); return { id: 'snap-1', ...args.data } } },
    franchiseSeason: { upsert: (args: any) => m.franchiseUpsert(args) },
    leagueAuditLog: { create: vi.fn() },
  }
  return {
    prisma: {
      redraftSeason: { findUnique: vi.fn(async () => m.season) },
      league: {
        findUnique: vi.fn(async () => ({
          lifecycleState: 'completed',
          platformLeagueId: null,
          scoring: 'ppr',
          isDynasty: false,
          settingsSnapshotVersion: 1,
          teams: [],
        })),
      },
      leagueSeason: { findUnique: vi.fn(async () => null) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})
vi.mock('@/lib/events', () => ({ EVENT: {}, getPlatformEvents: () => ({ emitInTx: vi.fn() }) }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: m.fanout }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ transitionLeagueStateInTransaction: vi.fn() }))
vi.mock('@/lib/league/systemActor', () => ({ auditUserId: (id: string) => id }))

import { enterRedraftOffseason, readBracketResult } from '@/lib/redraft/offseason/RedraftOffseasonService'

function roster(id: string, wins: number, pointsFor: number) {
  return {
    id,
    ownerId: `owner-${id}`,
    ownerName: `Owner ${id}`,
    teamName: `Team ${id}`,
    avatarUrl: null,
    wins,
    losses: 14 - wins,
    ties: 0,
    pointsFor,
    pointsAgainst: 1000,
    playoffSeed: wins >= 8 ? 1 : null,
    players: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.season = {
    id: 'season-1',
    leagueId: 'L1',
    season: 2026,
    sport: 'NFL',
    status: 'complete',
    updatedAt: new Date('2027-01-05T00:00:00Z'),
    // Standings order, as the query returns it: A led the regular season.
    rosters: [roster('A', 12, 1800), roster('B', 10, 1700), roster('C', 8, 1650), roster('D', 4, 1400)],
    playoffBracket: {
      id: 'b1',
      status: 'complete',
      structure: {
        championRosterId: 'C',
        runnerUpRosterId: 'B',
        finalStandings: [
          { finish: 1, rosterId: 'C' },
          { finish: 2, rosterId: 'B' },
          { finish: 3, rosterId: 'A' },
          { finish: 4, rosterId: 'D' },
        ],
      },
    },
  }
})

describe('enterRedraftOffseason — the champion comes from the bracket', () => {
  it('names the bracket winner champion and keeps the standings leader as regular-season winner', async () => {
    const res = await enterRedraftOffseason('season-1', 'system:week-roller')
    expect(res.ok).toBe(true)

    const data = m.seasonCreate.mock.calls[0][0].data
    expect(data.championName).toBe('Team C')
    expect(data.runnerUpName).toBe('Team B')
    expect(data.regularSeasonWinnerName).toBe('Team A')
    expect(data.teamRecords.map((r: any) => [r.rosterId, r.rank])).toEqual([
      ['C', 1],
      ['B', 2],
      ['A', 3],
      ['D', 4],
    ])
  })

  it('FranchiseSeason credits the title to the bracket winner only', async () => {
    await enterRedraftOffseason('season-1', 'system:week-roller')
    const byRoster = new Map(m.franchiseUpsert.mock.calls.map((c) => [c[0].create.rosterId, c[0].create]))
    expect(byRoster.get('C')).toMatchObject({ wonChampionship: true, runnerUp: false, finalRank: 1 })
    expect(byRoster.get('A')).toMatchObject({ wonChampionship: false, finalRank: 3 })
    expect(byRoster.get('B')).toMatchObject({ runnerUp: true })
  })

  it('announces the champion in the season-end message every member receives', async () => {
    await enterRedraftOffseason('season-1', 'system:week-roller')
    expect(m.fanout.mock.calls[0][0].title).toBe('Team C won the championship')
    expect(m.fanout.mock.calls[0][0].message).toContain('Team C are your 2026 champions')
  })

  it('a season with no finished bracket falls back to standings order, as before', async () => {
    m.season.playoffBracket = null
    await enterRedraftOffseason('season-1', 'system:week-roller')
    const data = m.seasonCreate.mock.calls[0][0].data
    expect(data.championName).toBe('Team A')
    expect(data.regularSeasonWinnerName).toBe('Team A')
  })
})

describe('readBracketResult', () => {
  it('is null for a bracket with no champion recorded', () => {
    expect(readBracketResult(null)).toBeNull()
    expect(readBracketResult({ rounds: 3 })).toBeNull()
  })

  it('still ranks champion and runner-up when finalStandings is missing', () => {
    const r = readBracketResult({ championRosterId: 'X', runnerUpRosterId: 'Y' })!
    expect(r.finishByRosterId.get('X')).toBe(1)
    expect(r.finishByRosterId.get('Y')).toBe(2)
  })
})
