/**
 * DAILY vs WEEKLY BEST BALL (lib/bestball/scoringPeriod.ts, lib/bestball/dailyBestBall.ts).
 *
 * Weekly (the default) starts ONE optimal lineup on weekly totals. Daily — a commissioner choice for
 * NBA / NHL / MLB — sums each Eastern day's optimal lineup from the players on the roster that day.
 * The pinned case: two guards, one G seat. Monday X 30 / Y 0, Tuesday X 0 / Y 25. Weekly counts 30,
 * daily counts 55.
 *
 * And the trap this change has to step around: every NBA/NHL/MLB/NCAAB best ball league created before
 * it STORED `scoringPeriod: 'daily'` (the old profile default) and was always scored weekly. Those stay
 * weekly — only a league carrying the `dailyBestBall` marker is daily.
 *
 * NBA 2026 opens Tuesday 20 Oct, so week 1 is 20–26 Oct.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  adminAuditLog: { create: vi.fn() },
  league: { findFirst: vi.fn(), findUnique: vi.fn() },
  exileWeeklyEntry: { findMany: vi.fn() },
  playerGameLogCache: { findMany: vi.fn() },
  playerGameStat: { findMany: vi.fn(), findFirst: vi.fn(async () => null) },
  sportsDataCache: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  playerIdentityMap: { findFirst: vi.fn(), findMany: vi.fn() },
  playerWeeklyScore: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  playerDailyScore: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  redraftDailyLineup: { findMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
  sportsGame: { findMany: vi.fn(async () => []) },
  sportsPlayer: { findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { buildBestBallSlots, calculateScoreFromSportConfig, scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { computeDailyBestBall } from '@/lib/bestball/dailyBestBall'
import { computeOptimalLineup } from '@/lib/lineup-optimizer/optimalLineup'
import { isDailyBestBallLeague, resolveBestBallScoringPeriod, withEffectiveScoringPeriod } from '@/lib/bestball/scoringPeriod'
import { getBestBallSportProfile, getDefaultBestBallSettings, normalizeBestBallSettings } from '@/lib/bestball/rules'
import { buildBestBallWarRoomPrompt } from '@/lib/best-ball-war-room/bestBallWarRoomPrompt'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeRiGameBox } from '@/lib/sports-data/rollingInsightsGameLogs'
import { clearDerivedDailySportSeasonStarts, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { resetDailySportSeasonStartChecks } from '@/lib/season-week/deriveDailySportSeasonStart'
import { resetDailyBestBallScheduleWarnings } from '@/lib/bestball/dailyScheduleStatus'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ONE_G_SEAT = { roster: { config: { sections: [{ slots: { G: 1, BN: 3 } }] } } }
const DAILY_BB = { ...ONE_G_SEAT, best_ball_settings: { scoringPeriod: 'daily', dailyBestBall: true, contestStructure: 'season_long' } }
const WEEKLY_BB = { ...ONE_G_SEAT, best_ball_settings: { scoringPeriod: 'weekly', dailyBestBall: false, contestStructure: 'season_long' } }
/** A league created before this change: the profile default said 'daily'; it was always scored weekly. */
const LEGACY_DAILY_DEFAULT = { ...ONE_G_SEAT, best_ball_settings: { scoringPeriod: 'daily', contestStructure: 'season_long' } }

const STATS: Record<string, Array<[string, number]>> = {
  X: [['2026-10-20', 30]],
  Y: [['2026-10-21', 25]],
}

describe('the pure daily optimizer', () => {
  it('two guards, one G seat: weekly counts 30, daily counts 55', () => {
    const slots = [{ slot: 'G', eligible: ['PG', 'SG'], count: 1 }]
    const weekly = computeOptimalLineup({
      players: [
        { playerId: 'X', positions: ['PG'], points: 30 },
        { playerId: 'Y', positions: ['PG'], points: 25 },
      ],
      slots,
    })
    expect(weekly.total).toBe(30)

    const daily = computeDailyBestBall({
      slots,
      days: ['2026-10-20', '2026-10-21'],
      candidates: [
        { playerId: 'X', positions: ['PG'], playerName: 'X', onRosterDays: new Set(['2026-10-20', '2026-10-21']), pointsByDay: new Map([['2026-10-20', 30], ['2026-10-21', 0]]) },
        { playerId: 'Y', positions: ['PG'], playerName: 'Y', onRosterDays: new Set(['2026-10-20', '2026-10-21']), pointsByDay: new Map([['2026-10-20', 0], ['2026-10-21', 25]]) },
      ],
    })
    expect(daily.total).toBe(55)
    expect(daily.counted).toEqual([
      { playerId: 'X', playerName: 'X', points: 30, days: 1 },
      { playerId: 'Y', playerName: 'Y', points: 25, days: 1 },
    ])
    expect(daily.days.map((d) => [d.day, d.total, d.assignments.map((a) => a.playerId)])).toEqual([
      ['2026-10-20', 30, ['X']],
      ['2026-10-21', 25, ['Y']],
    ])
  })

  it('a player counts only on the days he is on the roster', () => {
    const slots = [{ slot: 'G', eligible: ['PG'], count: 1 }]
    const daily = computeDailyBestBall({
      slots,
      days: ['2026-10-20', '2026-10-21'],
      candidates: [
        // Dropped after Monday: his Tuesday 50 belongs to nobody here.
        { playerId: 'X', positions: ['PG'], playerName: 'X', onRosterDays: new Set(['2026-10-20']), pointsByDay: new Map([['2026-10-20', 10], ['2026-10-21', 50]]) },
        { playerId: 'Y', positions: ['PG'], playerName: 'Y', onRosterDays: new Set(['2026-10-20', '2026-10-21']), pointsByDay: new Map([['2026-10-21', 5]]) },
      ],
    })
    expect(daily.total).toBe(15)
  })
})

describe('which leagues are daily', () => {
  it('only a daily-capable sport with the marker, never a tournament, never a legacy default', () => {
    expect(resolveBestBallScoringPeriod({ sport: 'NBA', settings: DAILY_BB })).toBe('daily')
    expect(resolveBestBallScoringPeriod({ sport: 'NHL', settings: DAILY_BB })).toBe('daily')
    expect(resolveBestBallScoringPeriod({ sport: 'MLB', settings: DAILY_BB })).toBe('daily')
    expect(resolveBestBallScoringPeriod({ sport: 'NBA', settings: LEGACY_DAILY_DEFAULT })).toBe('weekly')
    expect(resolveBestBallScoringPeriod({ sport: 'NFL', settings: DAILY_BB })).toBe('weekly')
    expect(resolveBestBallScoringPeriod({ sport: 'NCAAB', settings: DAILY_BB })).toBe('weekly')
    expect(resolveBestBallScoringPeriod({ sport: 'NBA', settings: { best_ball_settings: { ...DAILY_BB.best_ball_settings, contestStructure: 'tournament' } } })).toBe('weekly')
    expect(resolveBestBallScoringPeriod({ sport: 'NBA', settings: {} })).toBe('weekly')
    expect(isDailyBestBallLeague({ sport: 'NBA', settings: DAILY_BB, bestBallMode: false })).toBe(false)
    expect(withEffectiveScoringPeriod('NBA', LEGACY_DAILY_DEFAULT)).toMatchObject({ scoringPeriod: 'weekly', dailyBestBall: false })
  })

  it('weekly is the default for every sport, with the tiebreaker defaults unchanged', () => {
    for (const sport of ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']) {
      expect(getBestBallSportProfile(sport).scoringPeriod, sport).toBe('weekly')
      expect(getDefaultBestBallSettings(sport).scoringPeriod, sport).toBe('weekly')
      expect(getDefaultBestBallSettings(sport).dailyBestBall, sport).toBe(false)
    }
    // The old rule (`weekly ? max_week : points_for`) kept for every sport.
    expect(getDefaultBestBallSettings('NBA').tieRule).toBe('points_for')
    expect(getDefaultBestBallSettings('NCAAB').tieRule).toBe('points_for')
    expect(getDefaultBestBallSettings('NFL').tieRule).toBe('max_week')
    expect(getDefaultBestBallSettings('SOCCER').tieRule).toBe('max_week')
    expect(['NBA', 'NHL', 'MLB'].every((s) => getBestBallSportProfile(s).supportsDailyScoring)).toBe(true)
    expect(['NFL', 'NCAAF', 'NCAAB', 'SOCCER'].some((s) => getBestBallSportProfile(s).supportsDailyScoring)).toBe(false)
  })

  it('normalizing a daily choice writes the marker; a sport without daily stats is weekly', () => {
    expect(normalizeBestBallSettings({ sport: 'NBA', conceptSetup: { bestBall: { scoringPeriod: 'daily' } } })).toMatchObject({ scoringPeriod: 'daily', dailyBestBall: true })
    expect(normalizeBestBallSettings({ sport: 'NFL', conceptSetup: { bestBall: { scoringPeriod: 'daily' } } })).toMatchObject({ scoringPeriod: 'weekly', dailyBestBall: false })
    expect(normalizeBestBallSettings({ sport: 'NBA', conceptSetup: {} })).toMatchObject({ scoringPeriod: 'weekly', dailyBestBall: false })
  })

  it('the war room prompt says which one the league uses', () => {
    const base = { sport: 'NBA', season: 2026, teamCount: 12, draftComplete: true, ruleConfigurationVerified: true, bestBall: { mode: 'standard', draftMode: 'snake', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false }, roster: { lineupSlots: [], startingSlots: 0, recommendedRosterSize: 15 }, teams: [], missingDataFlags: [], availability: {} }
    const prompt = (scoringPeriod: string) =>
      buildBestBallWarRoomPrompt({ context: { ...base, scoring: { sport: 'NBA', scoringPreset: 'PPR', scoringPeriod, matchupFormat: 'h2h', cumulative: false } } } as never)
    expect(prompt('daily')).toMatch(/DAILY BEST BALL.*sum of the days/)
    expect(prompt('weekly')).toMatch(/WEEKLY BEST BALL.*each week/)
    expect(prompt('weekly')).not.toMatch(/each weekly period/)
  })
})

describe('scoring a best ball week', () => {
  function arrange(settings: unknown, opts: { dailyRows?: boolean } = {}) {
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings, bestBallMode: true, leagueType: 'best_ball', leagueVariant: null, platform: 'manual' })
    db.redraftRosterPlayer.findMany.mockResolvedValue(
      ['X', 'Y'].map((id) => ({
        playerId: id,
        position: 'PG',
        slotType: 'BN',
        rosterId: 'r1',
        sport: 'NBA',
        playerName: id,
        team: 'BOS',
        droppedAt: null,
        addedAt: new Date('2026-10-01T00:00:00Z'),
        acquisitionType: 'drafted',
      })),
    )
    db.roster.findMany.mockResolvedValue([])
    db.afRosterLineupAssignment.findMany.mockResolvedValue([])
    db.redraftDailyLineup.findMany.mockResolvedValue([])
    db.playerDailyScore.findMany.mockResolvedValue(
      opts.dailyRows === false
        ? []
        : Object.entries(STATS).flatMap(([playerId, days]) => days.map(([d, pts]) => ({ playerId, scoringDay: day(d), stats: { pts }, isFinalized: false }))),
    )
    db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
      const id = where.playerId_week_season_sport.playerId
      return { stats: { pts: (STATS[id] ?? []).reduce((s, [, p]) => s + p, 0) }, isFinalized: true }
    })
  }
  const f = (n: number) => calculateScoreFromSportConfig('L1', 'x', 1, { pts: n }, 'PG')

  beforeEach(() => vi.clearAllMocks())

  it('a daily league sums each day\'s best lineup: 30 + 25', async () => {
    arrange(DAILY_BB)
    const expected = Math.round(((await f(30)) + (await f(25))) * 100) / 100
    expect(expected).toBeGreaterThan(Math.round((await f(30)) * 100) / 100)

    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })

    expect(r.points).toBe(expected)
    expect(r.allFinal).toBe(true)
    expect(r.missingPlayerIds).toEqual([])
    expect(r.bestBall?.period).toBe('daily')
    expect(r.bestBall?.days?.map((d) => d.day)).toEqual(['2026-10-20', '2026-10-21'])
    expect(r.bestBall?.counted?.map((c) => [c.playerId, c.days])).toEqual([['X', 1], ['Y', 1]])
  })

  it('the SAME stats in a weekly league count one lineup on weekly totals: 30', async () => {
    arrange(WEEKLY_BB)
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })
    expect(r.points).toBe(Math.round((await f(30)) * 100) / 100)
    expect(r.bestBall?.period).toBeUndefined()
    expect(r.bestBall?.assignments.map((a) => a.playerId)).toEqual(['X'])
    expect(db.playerDailyScore.findMany).not.toHaveBeenCalled()
  })

  it('a legacy league whose stored "daily" was only the old default stays weekly', async () => {
    arrange(LEGACY_DAILY_DEFAULT)
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })
    expect(r.points).toBe(Math.round((await f(30)) * 100) / 100)
    expect(db.playerDailyScore.findMany).not.toHaveBeenCalled()
  })

  it("hands back the daily optimizer's inputs when asked (the Guilly stat-correction baseline), only for a daily week", async () => {
    arrange(DAILY_BB)
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026, collectDailyBestBallDetail: true })
    expect(r.dailyBestBall?.days).toEqual(expect.arrayContaining(['2026-10-20', '2026-10-21']))
    const byId = new Map(r.dailyBestBall!.players.map((p) => [p.playerId, p]))
    expect(byId.get('X')).toMatchObject({ sport: 'NBA', position: 'PG', pointsByDay: { '2026-10-20': await f(30) } })
    expect(byId.get('Y')).toMatchObject({ sport: 'NBA', position: 'PG', pointsByDay: { '2026-10-21': await f(25) } })
    expect(byId.get('X')!.onRosterDays).toEqual(expect.arrayContaining(['2026-10-20', '2026-10-21']))
    // The same optimizer over the recorded inputs lands the chop's own total.
    const again = computeDailyBestBall({
      candidates: r.dailyBestBall!.players.map((p) => ({
        playerId: p.playerId,
        positions: [p.position!],
        playerName: null,
        onRosterDays: new Set(p.onRosterDays),
        pointsByDay: new Map(Object.entries(p.pointsByDay)),
      })),
      slots: buildBestBallSlots('NBA', DAILY_BB),
      days: r.dailyBestBall!.days,
    })
    expect(again.total).toBe(r.points)

    // Not asked: absent, so `updateMatchupScores` never carries it. A weekly week: absent even when asked.
    expect((await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })).dailyBestBall).toBeUndefined()
    arrange(WEEKLY_BB)
    expect((await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026, collectDailyBestBallDetail: true })).dailyBestBall).toBeUndefined()
  })

  it('a player with weekly stats but no per-day rows yet is missing, never scored 0', async () => {
    arrange(DAILY_BB, { dailyRows: false })
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })
    expect(r.allFinal).toBe(false)
    expect(r.missingPlayerIds.sort()).toEqual(['X', 'Y'])
    expect(r.points).toBe(0)
  })
})

describe('the stat sync writes per-day rows for a daily best ball league', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' })
    db.playerIdentityMap.findFirst.mockResolvedValue(null)
    db.playerIdentityMap.findMany.mockResolvedValue([])
    db.playerWeeklyScore.upsert.mockResolvedValue({})
    db.playerDailyScore.upsert.mockResolvedValue({})
    db.playerDailyScore.deleteMany.mockResolvedValue({ count: 0 })
    db.sportsPlayer.findFirst.mockResolvedValue(null)
    db.sportsGame.findMany.mockResolvedValue([])
    db.playerGameLogCache.findMany.mockResolvedValue([])
    db.exileWeeklyEntry.findMany.mockResolvedValue([])
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'roster-1' }])
    db.redraftSeason.findFirst.mockResolvedValue({ id: 'season-1', leagueId: 'league-1', sport: 'NBA', season: 2026, currentWeek: 1 })
    db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'p1', sport: 'NBA', position: 'PG', team: 'BOS' }])
    db.playerGameStat.findMany.mockResolvedValue([
      { playerId: 'p1', gameDate: day('2026-10-20'), normalizedStatMap: { stats: { points: 20, rebounds: 5 } } },
      { playerId: 'p1', gameDate: day('2026-10-22'), normalizedStatMap: { stats: { points: 31, rebounds: 2 } } },
    ])
  })

  async function runSync(settings: unknown, bestBallMode = true) {
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings })
    db.league.findUnique.mockResolvedValue({ platform: 'allfantasy', survivorMode: false, settings, bestBallMode })
    const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
    return syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1', week: 1, actorId: 'admin-1' })
  }

  it('daily best ball: one row per game day', async () => {
    const summary = await runSync(DAILY_BB)
    expect(summary.dailyScoresUpserted).toBe(2)
  })

  it('weekly and legacy-default leagues: no daily rows, as before', async () => {
    for (const settings of [WEEKLY_BB, LEGACY_DAILY_DEFAULT]) {
      vi.mocked(db.playerDailyScore.upsert).mockClear()
      const summary = await runSync(settings)
      expect(summary.dailyScoresUpserted).toBeUndefined()
      expect(db.playerDailyScore.upsert).not.toHaveBeenCalled()
    }
    const notBestBall = await runSync(DAILY_BB, false)
    expect(notBestBall.dailyScoresUpserted).toBeUndefined()
  })
})

/*
 * MLB DAILY BEST BALL HAS DATA. The audit (2026-11-06) said "MLB daily has no data until an MLB stat sync
 * exists" — that was wrong: the scheduled `import-player-game-stats?multiSport=1` sweep writes MLB rows to
 * `player_game_stats` from Rolling Insights `/live` (riCredentialsFor -> the second account), and the
 * weekly sync treats MLB as a daily sport (MLB normalizer registered in dailySportStatNormalization.ts),
 * so it writes the per-day rows the daily scorer reads. These pin that path with the COMMITTED
 * `/live` MLB fixture, run through the ingest's own box parser — the shape production stores.
 */
describe('MLB daily best ball: the sync writes per-day rows and the week scores from them', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'contracts/rolling-insights/fixtures/live.MLB.json'), 'utf8'))
  const games: unknown[] = Array.isArray(raw) ? raw : (raw.data?.MLB ?? raw.data ?? Object.values(raw)[0])
  const LINES = games.flatMap((g) => normalizeRiGameBox(g)?.lines ?? [])
  /** What the ingest stores as `normalizedStatMap` (rollingInsightsGameLogs.normalizedMapFor). */
  const stored = (line: { group: string; raw: Record<string, unknown> }) => {
    const stats: Record<string, number> = {}
    for (const [k, v] of Object.entries(line.raw)) {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null
      if (n != null) stats[k] = n
    }
    return { group: line.group, stats }
  }
  // A hitter with a hit, from the captured response.
  const batting = LINES.find((l) => l.group === 'batting' && Number((l.raw as Record<string, unknown>).H ?? 0) > 0)!
  const window = resolveDailySportWeekWindow('MLB', 2026, 1)!
  const D1 = window.start
  const D2 = new Date(window.start.getTime() + 86_400_000)
  const MLB_DAILY_BB = {
    roster: { config: { sections: [{ slots: { UTIL: 1, BN: 3 } }] } },
    best_ball_settings: { scoringPeriod: 'daily', dailyBestBall: true, contestStructure: 'season_long' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    db.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' })
    db.playerIdentityMap.findFirst.mockResolvedValue(null)
    db.playerIdentityMap.findMany.mockResolvedValue([])
    db.playerWeeklyScore.upsert.mockResolvedValue({})
    db.playerDailyScore.upsert.mockResolvedValue({})
    db.playerDailyScore.deleteMany.mockResolvedValue({ count: 0 })
    db.sportsPlayer.findFirst.mockResolvedValue(null)
    db.sportsGame.findMany.mockResolvedValue([])
    db.playerGameLogCache.findMany.mockResolvedValue([])
    db.exileWeeklyEntry.findMany.mockResolvedValue([])
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'roster-1' }])
    db.redraftSeason.findFirst.mockResolvedValue({ id: 'season-1', leagueId: 'league-1', sport: 'MLB', season: 2026, currentWeek: 1 })
    db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'h1', sport: 'MLB', position: 'OF', team: 'NYY' }])
    db.league.findFirst.mockResolvedValue({ sport: 'MLB', settings: MLB_DAILY_BB })
    db.league.findUnique.mockResolvedValue({ platform: 'allfantasy', survivorMode: false, settings: MLB_DAILY_BB, bestBallMode: true })
  })

  it('the fixture has a batting line with a hit and MLB 2026 has a week-1 window (else this proves nothing)', () => {
    expect(batting).toBeTruthy()
    expect(window).toBeTruthy()
  })

  it("one per-day row per game day, stats group-aware (a hitter's hits on batting keys)", async () => {
    db.playerGameStat.findMany.mockResolvedValue([
      { playerId: 'h1', sportType: 'MLB', season: 2026, gameDate: D1, normalizedStatMap: stored(batting) },
      { playerId: 'h1', sportType: 'MLB', season: 2026, gameDate: D2, normalizedStatMap: stored(batting) },
    ])
    const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
    const summary = await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1', week: 1, actorId: 'admin-1' })

    expect(summary.dailyScoresUpserted).toBe(2)
    expect(summary.scoresUpserted).toBe(1)
    const days = db.playerDailyScore.upsert.mock.calls.map(
      (c: unknown[]) => (c[0] as { create: { scoringDay: Date; sport: string; stats: Record<string, number> } }).create,
    )
    expect(days.map((d) => d.scoringDay.toISOString().slice(0, 10))).toEqual([D1, D2].map((d) => d.toISOString().slice(0, 10)))
    for (const d of days) {
      expect(d.sport).toBe('MLB')
      expect(d.stats.h).toBeGreaterThan(0)
      expect(d.stats.p_h).toBeUndefined()
    }
  })

  it("the week scores the sum of each day's best line from those rows", async () => {
    const bat = { h: 2, single: 1, hr: 1, r: 1, rbi: 2 }
    const bat2 = { h: 1, single: 1, r: 1, sb: 1 }
    db.redraftRosterPlayer.findMany.mockResolvedValue(
      [['h1', 'OF'], ['h2', '1B']].map(([id, pos]) => ({
        playerId: id, position: pos, slotType: 'BN', rosterId: 'r1', sport: 'MLB', playerName: id, team: 'NYY',
        droppedAt: null, addedAt: new Date('2026-03-01T00:00:00Z'), acquisitionType: 'drafted',
      })),
    )
    db.roster.findMany.mockResolvedValue([])
    db.afRosterLineupAssignment.findMany.mockResolvedValue([])
    db.redraftDailyLineup.findMany.mockResolvedValue([])
    db.league.findFirst.mockResolvedValue({ sport: 'MLB', settings: MLB_DAILY_BB, bestBallMode: true, leagueType: 'best_ball', leagueVariant: null, platform: 'manual' })
    db.playerDailyScore.findMany.mockResolvedValue([
      { playerId: 'h1', scoringDay: D1, stats: bat, isFinalized: true },
      { playerId: 'h2', scoringDay: D2, stats: bat2, isFinalized: true },
    ])
    db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) =>
      ({ stats: where.playerId_week_season_sport.playerId === 'h1' ? bat : bat2, isFinalized: true }))

    const hit = await calculateScoreFromSportConfig('L1', 'h1', 1, bat, 'OF')
    const hit2 = await calculateScoreFromSportConfig('L1', 'h2', 1, bat2, '1B')
    expect(hit).toBeGreaterThan(0)
    expect(hit2).toBeGreaterThan(0)

    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })
    expect(r.bestBall?.period).toBe('daily')
    expect(r.missingPlayerIds).toEqual([])
    // One UTIL seat: one hitter counts on day 1, the other on day 2 — weekly would count only one.
    expect(r.points).toBe(Math.round((hit + hit2) * 100) / 100)
    expect(r.bestBall?.counted?.map((c) => c.playerId).sort()).toEqual(['h1', 'h2'])
  })
})

/*
 * A SEASON PAST THE CURATED TABLE (NBA curates 2026 only; 2027 is a dynasty league's year 2). Its opener
 * is derived from the stored schedule — here a played game the Rolling Insights `/live` ingest labelled
 * regular season on Tue 19 Oct 2027. The scorer must derive it itself: scoring runs in processes the stat
 * sync never primed, and it used to find no window there and silently score the daily league weekly.
 */
describe('daily best ball in a season the curated table does not list', () => {
  const STATS_2027: Record<string, Array<[string, number]>> = { X: [['2027-10-19', 30]], Y: [['2027-10-20', 25]] }
  function arrange2027(opts: { labelledOpener: boolean }) {
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: DAILY_BB, bestBallMode: true, leagueType: 'best_ball', leagueVariant: null, platform: 'manual' })
    db.redraftRosterPlayer.findMany.mockResolvedValue(
      ['X', 'Y'].map((id) => ({
        playerId: id, position: 'PG', slotType: 'BN', rosterId: 'r1', sport: 'NBA', playerName: id, team: 'BOS',
        droppedAt: null, addedAt: new Date('2027-10-01T00:00:00Z'), acquisitionType: 'drafted',
      })),
    )
    db.roster.findMany.mockResolvedValue([])
    db.afRosterLineupAssignment.findMany.mockResolvedValue([])
    db.redraftDailyLineup.findMany.mockResolvedValue([])
    db.playerGameStat.findFirst.mockResolvedValue(opts.labelledOpener ? { gameDate: day('2027-10-19') } : null)
    db.playerDailyScore.findMany.mockResolvedValue(
      Object.entries(STATS_2027).flatMap(([playerId, days]) => days.map(([d, pts]) => ({ playerId, scoringDay: day(d), stats: { pts }, isFinalized: false }))),
    )
    db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
      const id = where.playerId_week_season_sport.playerId
      return { stats: { pts: (STATS_2027[id] ?? []).reduce((s, [, p]) => s + p, 0) }, isFinalized: true }
    })
  }
  const f = (n: number) => calculateScoreFromSportConfig('L1', 'x', 1, { pts: n }, 'PG')

  beforeEach(() => {
    vi.clearAllMocks()
    clearDerivedDailySportSeasonStarts()
    resetDailySportSeasonStartChecks()
    resetDailyBestBallScheduleWarnings()
  })

  it('precondition: 2027 has no window until something derives the opener (else this proves nothing)', () => {
    expect(resolveDailySportWeekWindow('NBA', 2027, 1)).toBeNull()
  })

  it('derives the opener from the stored schedule and scores the week daily: 30 + 25', async () => {
    arrange2027({ labelledOpener: true })
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2027 })
    expect(r.bestBall?.period).toBe('daily')
    expect(r.bestBall?.days?.map((d) => d.day)).toEqual(['2027-10-19', '2027-10-20'])
    expect(r.points).toBe(Math.round(((await f(30)) + (await f(25))) * 100) / 100)
  })

  it('with no labelled game stored it still falls back, and says so once', async () => {
    arrange2027({ labelledOpener: false })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2027 })
    await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2027 })
    expect(r.bestBall?.period).toBeUndefined()
    expect(db.playerDailyScore.findMany).not.toHaveBeenCalled()
    const ours = warn.mock.calls.filter((c) => String(c[0]).startsWith('[bestball] daily best ball NBA 2027'))
    expect(ours).toHaveLength(1)
    warn.mockRestore()
  })
})
