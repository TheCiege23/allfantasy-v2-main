/**
 * Native leagues must write `SeasonResult` when a season is archived.
 *
 * The record book and season awards read `SeasonResult`, and only the import backfills ever wrote
 * it — so a league created on AllFantasy finished season after season with an empty record book.
 * `enterRedraftOffseason` now upserts one row per team, keyed by the league's GENERIC `Roster.id`
 * (what every reader resolves to a manager), never the per-season `RedraftRoster.id`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  seasonResultUpsert: vi.fn(),
  franchiseUpsert: vi.fn(),
  season: null as any,
  lifecycleState: 'completed' as string,
  existingSnapshot: null as any,
  lockedSnapshot: null as any,
  genericRosters: [] as Array<{ id: string; platformUserId: string | null }>,
}))

vi.mock('@/lib/prisma', () => {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    leagueSeason: {
      findUnique: vi.fn(async () => m.lockedSnapshot),
      create: (args: any) => ({ id: 'snap-1', ...args.data }),
    },
    franchiseSeason: { upsert: (args: any) => m.franchiseUpsert(args) },
    leagueAuditLog: { create: vi.fn() },
    roster: { findMany: vi.fn(async () => m.genericRosters) },
    seasonResult: { upsert: (args: any) => m.seasonResultUpsert(args) },
  }
  return {
    prisma: {
      redraftSeason: { findUnique: vi.fn(async () => m.season) },
      league: {
        findUnique: vi.fn(async () => ({
          lifecycleState: m.lifecycleState,
          bestBallMode: false,
          bbContestId: null,
          bbTiebreaker: 'advance_all',
          settings: {},
          platformLeagueId: null,
          scoring: 'ppr',
          isDynasty: false,
          settingsSnapshotVersion: 1,
          teams: [],
        })),
      },
      bestBallContest: { findUnique: vi.fn(async () => null) },
      leagueSeason: { findUnique: vi.fn(async () => m.existingSnapshot) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})
vi.mock('@/lib/events', () => ({ EVENT: {}, getPlatformEvents: () => ({ emitInTx: vi.fn() }) }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ transitionLeagueStateInTransaction: vi.fn() }))
vi.mock('@/lib/league/systemActor', () => ({ auditUserId: (id: string) => id }))

import { enterRedraftOffseason } from '@/lib/redraft/offseason/RedraftOffseasonService'

function roster(id: string, wins: number, pointsFor: number, pointsAgainst: number) {
  return {
    id: `redraft-${id}`,
    ownerId: `user-${id}`,
    ownerName: `Owner ${id}`,
    teamName: `Team ${id}`,
    avatarUrl: null,
    wins,
    losses: 14 - wins,
    ties: 0,
    pointsFor,
    pointsAgainst,
    playoffSeed: wins >= 8 ? 1 : null,
    players: [],
  }
}

function upsertsByRoster() {
  return new Map(m.seasonResultUpsert.mock.calls.map((c) => [c[0].where.uniq_season_result_league_season_roster.rosterId, c[0]]))
}

beforeEach(() => {
  vi.clearAllMocks()
  m.lifecycleState = 'completed'
  m.existingSnapshot = null
  m.lockedSnapshot = null
  // Generic rosters: A, B and C map by platformUserId; D's owner has no generic roster.
  m.genericRosters = [
    { id: 'generic-A', platformUserId: 'user-A' },
    { id: 'generic-B', platformUserId: 'user-B' },
    { id: 'generic-C', platformUserId: 'user-C' },
  ]
  m.season = {
    id: 'season-1',
    leagueId: 'L1',
    season: 2026,
    sport: 'NFL',
    status: 'complete',
    updatedAt: new Date('2027-01-05T00:00:00Z'),
    rosters: [roster('A', 12, 1800.5, 1500), roster('B', 10, 1700, 1550.25), roster('C', 8, 1650, 1600), roster('D', 4, 1400, 1700)],
    playoffBracket: {
      id: 'b1',
      status: 'complete',
      structure: { championRosterId: 'redraft-C', runnerUpRosterId: 'redraft-B' },
    },
  }
})

describe('enterRedraftOffseason — writes SeasonResult for a native league', () => {
  it('upserts one row per mapped team, keyed by generic Roster.id, with the season record and bracket champion', async () => {
    const res = await enterRedraftOffseason('season-1', 'system:week-roller')
    expect(res).toMatchObject({ ok: true, season: 2026 })

    const rows = upsertsByRoster()
    expect([...rows.keys()].sort()).toEqual(['generic-A', 'generic-B', 'generic-C'])
    expect(rows.get('generic-A')!.where.uniq_season_result_league_season_roster).toEqual({
      leagueId: 'L1',
      season: '2026',
      rosterId: 'generic-A',
    })
    expect(rows.get('generic-A')!.create).toEqual({
      leagueId: 'L1',
      season: '2026',
      rosterId: 'generic-A',
      wins: 12,
      losses: 2,
      pointsFor: 1800.5,
      pointsAgainst: 1500,
      champion: false,
    })
    expect(rows.get('generic-B')!.update).toEqual({ wins: 10, losses: 4, pointsFor: 1700, pointsAgainst: 1550.25, champion: false })
    // The bracket winner, not the regular-season leader, is the champion.
    expect(rows.get('generic-C')!.create.champion).toBe(true)
    expect(rows.get('generic-C')!.update.champion).toBe(true)
  })

  it('never keys a row by the per-season RedraftRoster id', async () => {
    await enterRedraftOffseason('season-1', 'system:week-roller')
    expect(m.seasonResultUpsert).toHaveBeenCalledTimes(3)
    for (const call of m.seasonResultUpsert.mock.calls) {
      expect(call[0].create.rosterId.startsWith('redraft-')).toBe(false)
    }
  })

  it('skips an owner with no generic roster, and one shared by two generic rosters, rather than guessing', async () => {
    m.genericRosters = [
      { id: 'generic-A', platformUserId: 'user-A' },
      { id: 'generic-B1', platformUserId: 'user-B' },
      { id: 'generic-B2', platformUserId: 'user-B' },
      { id: 'generic-C', platformUserId: 'user-C' },
    ]
    await enterRedraftOffseason('season-1', 'system:week-roller')
    expect([...upsertsByRoster().keys()].sort()).toEqual(['generic-A', 'generic-C'])
  })

  it('still upserts when another finalizer already committed the archive (snapshot present under the lock)', async () => {
    m.lockedSnapshot = { id: 'concurrent-archive', leagueId: 'L1', season: 2026 }
    await enterRedraftOffseason('season-1', 'system:week-roller')
    expect(m.franchiseUpsert).not.toHaveBeenCalled()
    expect([...upsertsByRoster().keys()].sort()).toEqual(['generic-A', 'generic-B', 'generic-C'])
  })

  it('a re-run on a league already in offseason repairs the rows from the archived teamRecords', async () => {
    m.lifecycleState = 'offseason'
    m.existingSnapshot = {
      id: 'snap-old',
      teamRecords: [
        { rosterId: 'redraft-C', ownerId: 'user-C', wins: 8, losses: 6, pointsFor: 1650, pointsAgainst: 1600, isChampion: true },
        { rosterId: 'redraft-A', ownerId: 'user-A', wins: 12, losses: 2, pointsFor: 1800.5, pointsAgainst: 1500, isChampion: false },
        { rosterId: 'redraft-D', ownerId: 'user-D', wins: 4, losses: 10, pointsFor: 1400, pointsAgainst: 1700, isChampion: false },
      ],
    }
    const res = await enterRedraftOffseason('season-1', 'system:week-roller')
    expect(res).toMatchObject({ ok: true, snapshotId: 'snap-old', alreadyInOffseason: true, season: 2026 })

    const rows = upsertsByRoster()
    expect([...rows.keys()].sort()).toEqual(['generic-A', 'generic-C'])
    expect(rows.get('generic-C')!.create).toMatchObject({ season: '2026', wins: 8, losses: 6, champion: true })
    expect(rows.get('generic-A')!.update).toEqual({ wins: 12, losses: 2, pointsFor: 1800.5, pointsAgainst: 1500, champion: false })
  })
})
