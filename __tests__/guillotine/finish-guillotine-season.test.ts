import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A GUILLOTINE SEASON ENDED BY WRITING `complete` AND NOTHING ELSE — no champion on record, no
 * season archive, no offseason. A guillotine league has no bracket, so the postseason roller never
 * reaches it. `finishGuillotineSeason` does the playoff finalizer's job for it, ranked by survival.
 */

const db = vi.hoisted(() => {
  const tx = {
    leagueChampionship: { upsert: vi.fn() },
    league: { updateMany: vi.fn() },
  }
  return {
    tx,
    redraftSeason: { updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    guillotineSeason: { updateMany: vi.fn(), findUnique: vi.fn() },
    roster: { findMany: vi.fn() },
    guillotineRosterState: { findMany: vi.fn() },
    guillotinePeriodScore: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
})
const m = vi.hoisted(() => ({ champion: vi.fn(), offseason: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/guillotine/endgameEngine', () => ({ determineFinalChampion: m.champion }))
vi.mock('@/lib/redraft/offseason/RedraftOffseasonService', () => ({ enterRedraftOffseason: m.offseason }))

import { finishGuillotineSeason, rankGuillotineFinish } from '@/lib/guillotine/finishGuillotineSeason'

const SEASON_CREATED = new Date('2026-09-10T00:00:00Z')

// Four teams. Engine ids R-*, season ids rr-*. A led on points and was chopped FIRST (week 2).
const SEASON_ROSTERS = [
  { id: 'rr-a', ownerId: 'user-a', ownerName: 'A', teamName: 'Team A', pointsFor: 900, isEliminated: true },
  { id: 'rr-b', ownerId: 'user-b', ownerName: 'B', teamName: 'Team B', pointsFor: 700, isEliminated: true },
  { id: 'rr-c', ownerId: 'user-c', ownerName: 'C', teamName: 'Team C', pointsFor: 600, isEliminated: true },
  { id: 'rr-d', ownerId: 'roster:R-d', ownerName: 'D', teamName: 'Team D', pointsFor: 500, isEliminated: false },
]
const LEAGUE_ROSTERS = [
  { id: 'R-a', platformUserId: 'user-a', redraftRosterId: 'rr-a' },
  { id: 'R-b', platformUserId: 'user-b', redraftRosterId: null },
  { id: 'R-c', platformUserId: 'user-c', redraftRosterId: null },
  { id: 'R-d', platformUserId: 'open-slot-4', redraftRosterId: null },
]

function arrange() {
  db.redraftSeason.updateMany.mockResolvedValue({ count: 1 })
  db.guillotineSeason.updateMany.mockResolvedValue({ count: 1 })
  db.redraftSeason.findUnique.mockResolvedValue({ id: 's1', leagueId: 'L1', season: 2026, rosters: SEASON_ROSTERS })
  db.redraftSeason.findFirst.mockResolvedValue(null)
  db.guillotineSeason.findUnique.mockResolvedValue({ createdAt: SEASON_CREATED, finalStageStartPeriod: null })
  db.roster.findMany.mockResolvedValue(LEAGUE_ROSTERS)
  db.guillotineRosterState.findMany.mockResolvedValue([
    { rosterId: 'R-a', choppedInPeriod: 2 },
    { rosterId: 'R-b', choppedInPeriod: 4 },
    { rosterId: 'R-c', choppedInPeriod: 3 },
  ])
  db.guillotinePeriodScore.findMany.mockResolvedValue([])
  db.tx.leagueChampionship.upsert.mockResolvedValue({})
  db.tx.league.updateMany.mockResolvedValue({ count: 1 })
  m.champion.mockResolvedValue('rr-d')
  m.offseason.mockResolvedValue({ ok: true, snapshotId: 'snap-1', alreadyInOffseason: false })
}

beforeEach(() => {
  vi.clearAllMocks()
  arrange()
})

describe('rankGuillotineFinish', () => {
  const rosters = [
    { id: 'a', isEliminated: true, pointsFor: 900 },
    { id: 'b', isEliminated: true, pointsFor: 700 },
    { id: 'c', isEliminated: false, pointsFor: 600 },
    { id: 'd', isEliminated: false, pointsFor: 500 },
    { id: 'e', isEliminated: true, pointsFor: 400 },
  ]

  it('champion, then the other survivors by final-stage points, then chops latest-first', () => {
    const order = rankGuillotineFinish({
      rosters,
      championId: 'd',
      chopped: new Map([['a', { period: 2, periodPoints: 80 }], ['b', { period: 5, periodPoints: 60 }]]),
      finalStagePoints: new Map([['c', 300], ['d', 250]]),
    })
    // `e` is eliminated with no chop on record — placed last, never dropped.
    expect(order).toEqual(['d', 'c', 'b', 'a', 'e'])
  })

  it('two teams chopped the same week: the higher scorer that week finished higher', () => {
    const order = rankGuillotineFinish({
      rosters: rosters.slice(0, 3),
      championId: 'c',
      chopped: new Map([['a', { period: 4, periodPoints: 61.5 }], ['b', { period: 4, periodPoints: 90 }]]),
      finalStagePoints: new Map(),
    })
    expect(order).toEqual(['c', 'b', 'a'])
  })

  it('ranks every roster exactly once, even with no champion', () => {
    const order = rankGuillotineFinish({ rosters, championId: null, chopped: new Map(), finalStagePoints: new Map() })
    expect([...order].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(new Set(order).size).toBe(rosters.length)
  })
})

describe('finishGuillotineSeason', () => {
  it('🛑 crowns the last team standing, not the points leader, and archives by survival', async () => {
    const r = await finishGuillotineSeason({ seasonId: 's1', guillotineSeasonId: 'g1' })

    expect(r).toEqual({ championRosterId: 'rr-d', archived: true })
    expect(db.tx.leagueChampionship.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { leagueId_season: { leagueId: 'L1', season: 2026 } },
      create: expect.objectContaining({ leagueId: 'L1', season: 2026, championUserId: 'roster:R-d', teamName: 'Team D', playoffRecord: null }),
    }))
    // Chopped week 4 (B) outlasted week 3 (C) outlasted week 2 (A).
    expect(m.offseason).toHaveBeenCalledWith('s1', 'system:guillotine-season', { finishOrder: ['rr-d', 'rr-b', 'rr-c', 'rr-a'] })
  })

  it('moves the league to `completed` first — the archive refuses any other state', async () => {
    await finishGuillotineSeason({ seasonId: 's1', guillotineSeasonId: 'g1' })
    expect(db.tx.league.updateMany).toHaveBeenCalledWith({
      where: { id: 'L1', lifecycleState: { in: ['setup', 'pre_draft', 'drafting', 'post_draft', 'in_season', 'playoffs'] } },
      data: { lifecycleState: 'completed' },
    })
    expect(db.tx.league.updateMany.mock.invocationCallOrder[0]).toBeLessThan(m.offseason.mock.invocationCallOrder[0]!)
  })

  it('marks both seasons complete (idempotently)', async () => {
    await finishGuillotineSeason({ seasonId: 's1', guillotineSeasonId: 'g1' })
    expect(db.redraftSeason.updateMany).toHaveBeenCalledWith({ where: { id: 's1', status: { not: 'complete' } }, data: { status: 'complete' } })
    expect(db.guillotineSeason.updateMany).toHaveBeenCalledWith({ where: { id: 'g1', status: { not: 'complete' } }, data: { status: 'complete' } })
  })

  it('reads only THIS season’s chops and scores', async () => {
    await finishGuillotineSeason({ seasonId: 's1', guillotineSeasonId: 'g1' })
    expect(db.guillotineRosterState.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { leagueId: 'L1', choppedInPeriod: { not: null }, choppedAt: { not: null, gte: SEASON_CREATED } },
    }))
    expect(db.guillotinePeriodScore.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', season: 2026 } }))
  })

  it('a final stage decided on points: survivors rank by final-stage points behind the champion', async () => {
    db.redraftSeason.findUnique.mockResolvedValue({
      id: 's1', leagueId: 'L1', season: 2026,
      rosters: SEASON_ROSTERS.map((r) => (r.id === 'rr-c' ? { ...r, isEliminated: false } : r)),
    })
    db.guillotineRosterState.findMany.mockResolvedValue([{ rosterId: 'R-a', choppedInPeriod: 2 }, { rosterId: 'R-b', choppedInPeriod: 4 }])
    db.guillotineSeason.findUnique.mockResolvedValue({ createdAt: SEASON_CREATED, finalStageStartPeriod: 15 })
    db.guillotinePeriodScore.findMany.mockResolvedValue([
      { rosterId: 'R-c', weekOrPeriod: 15, periodPoints: 120 },
      { rosterId: 'R-d', weekOrPeriod: 15, periodPoints: 110 },
      { rosterId: 'R-d', weekOrPeriod: 14, periodPoints: 999 }, // before the final stage: ignored
    ])
    m.champion.mockResolvedValue('rr-c')

    await finishGuillotineSeason({ seasonId: 's1', guillotineSeasonId: 'g1' })
    expect(m.offseason.mock.calls[0]![2]).toEqual({ finishOrder: ['rr-c', 'rr-d', 'rr-b', 'rr-a'] })
  })

  it('does not drag a league that has already started next season back into the offseason', async () => {
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's2' })
    const r = await finishGuillotineSeason({ seasonId: 's1', guillotineSeasonId: 'g1' })
    expect(r).toMatchObject({ archived: false, reason: 'newer_season_exists' })
    expect(db.tx.league.updateMany).not.toHaveBeenCalled()
    expect(m.offseason).not.toHaveBeenCalled()
  })

  it('a declined or failed archive is reported, never thrown — the champion is already on record', async () => {
    m.offseason.mockResolvedValueOnce({ ok: false, code: 'LEAGUE_NOT_COMPLETED' })
    expect(await finishGuillotineSeason({ seasonId: 's1', guillotineSeasonId: 'g1' }))
      .toEqual({ championRosterId: 'rr-d', archived: false, reason: 'LEAGUE_NOT_COMPLETED' })

    m.offseason.mockRejectedValueOnce(new Error('audit_logs_userId_fkey'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await finishGuillotineSeason({ seasonId: 's1', guillotineSeasonId: 'g1' }))
      .toEqual({ championRosterId: 'rr-d', archived: false, reason: 'archive_failed' })
    errors.mockRestore()
    expect(db.tx.leagueChampionship.upsert).toHaveBeenCalledTimes(2)
  })

  it('with no guillotine season row, the single survivor is still the champion', async () => {
    const r = await finishGuillotineSeason({ seasonId: 's1', guillotineSeasonId: null })
    expect(m.champion).not.toHaveBeenCalled()
    expect(r.championRosterId).toBe('rr-d')
  })
})
