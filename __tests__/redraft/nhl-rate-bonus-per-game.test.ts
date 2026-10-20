/**
 * NHL rate-stat bonuses — save %, GAA, shooting % — are evaluated PER GAME (owner's decision
 * 2026-10-20), in `normalizeNhlGameStats`, and a week's points are the sum of its games' points.
 *
 *   - weekly-lineup league: every game the starter played that week counts;
 *   - daily-lineup league: only the games on days he was in that day's starting lineup.
 *
 * The goalie lines below are chosen so the per-week reading gives a DIFFERENT answer, which is what
 * makes each test able to fail: .940 + .880 is a .910 week (one step over .900, not four), and a
 * 1.00 + 4.00 GAA week is exactly 2.50 (no bonus at all, not one).
 *
 * NHL 2026 opened Tuesday 29 Sep, so week 1 is 29 Sep – 5 Oct.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  adminAuditLog: { create: vi.fn() },
  league: { findFirst: vi.fn(), findUnique: vi.fn() },
  exileWeeklyEntry: { findMany: vi.fn() },
  playerGameLogCache: { findMany: vi.fn() },
  playerGameStat: { findMany: vi.fn() },
  playerIdentityMap: { findFirst: vi.fn(), findMany: vi.fn() },
  playerWeeklyScore: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  playerDailyScore: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  redraftDailyLineup: { findMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
  sportsGame: { findMany: vi.fn() },
  sportsPlayer: { findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { NHL_ALL_SCORING_CATEGORIES } from '@/lib/nhl-scoring/NhlScoringCategories'
import { NHL_SCORING_ENGINE_VERSION } from '@/lib/nhl-scoring/nhlScoringEngineContract'
import { buildLeagueStatScorer, scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { aggregateWeeklyStats, normalizeNhlGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const goalieLine = (saves: number, shotsAgainst: number, goalsAllowed: number, minutes = 60) => ({
  group: 'goalies',
  stats: { saves, shots_against: shotsAgainst, goals_allowed: goalsAllowed, time_on_ice_minutes: minutes, win: 0 },
})
const skaterLine = (goals: number, shots: number) => ({ group: 'skaters', stats: { goals, shots_on_goal: shots } })

/** A commissioner-saved store scoring only the given panel rows. */
function nhlSettings(only: Record<string, number>, extra: Record<string, unknown> = {}) {
  const rules: Record<string, number> = {}
  for (const k of NHL_ALL_SCORING_CATEGORIES.flatMap((c) => c.rows.map((r) => r.key))) rules[k] = 0
  Object.assign(rules, only)
  return { nhl_scoring_config: { rules, lastUpdatedBy: 'commish-1', engineVersion: NHL_SCORING_ENGINE_VERSION }, ...extra }
}
const scorerFor = (only: Record<string, number>, extra?: Record<string, unknown>) =>
  buildLeagueStatScorer({ sport: 'NHL', settings: nhlSettings(only, extra) })!

const GOOD = goalieLine(47, 50, 3) // .940, GAA 3.00
const BAD = goalieLine(44, 50, 6) //  .880, GAA 6.00

describe('save % bonus — per game', () => {
  it('a .940 game and an .880 game earn exactly one bonus: the .940 game\'s', () => {
    const games = [GOOD, BAD].map((l) => normalizeNhlGameStats(l).stats)
    expect(games.filter((s) => (s.g_sv_pct_bonus ?? 0) > 0)).toHaveLength(1)
    expect(games[0].g_sv_pct_bonus).toBeCloseTo(4, 9) // .940 is four .010 steps over .900
    expect(games[1].g_sv_pct_bonus).toBeUndefined()
  })

  it('the week scores the sum of its games, not the week\'s .910', () => {
    const scorer = scorerFor({ save_pct_bonus: 1 })
    const week = aggregateWeeklyStats([GOOD, BAD], normalizeNhlGameStats)
    const perGame = [GOOD, BAD].reduce((s, l) => s + scorer(normalizeNhlGameStats(l).stats), 0)
    expect(scorer(week.stats)).toBeCloseTo(4, 9)
    expect(scorer(week.stats)).toBeCloseTo(perGame, 9)
    // The rejected per-week reading: 91 saves on 100 shots is .910, one step.
    expect((91 / 100 - 0.9) / 0.01).toBeCloseTo(1, 9)
  })

  it('a game with no shot against earns nothing, not a perfect 1.000', () => {
    expect(normalizeNhlGameStats(goalieLine(0, 0, 0, 5)).stats.g_sv_pct_bonus).toBeUndefined()
  })
})

describe('GAA bonus — per game', () => {
  const ONE = goalieLine(29, 30, 1) // GAA 1.00
  const FOUR = goalieLine(26, 30, 4) // GAA 4.00

  it('a 1.00 game and a 4.00 game earn exactly one bonus, though the week is exactly 2.50', () => {
    const scorer = scorerFor({ gaa_bonus: 3 })
    const games = [ONE, FOUR].map((l) => normalizeNhlGameStats(l).stats)
    expect(games.map((s) => s.g_gaa_bonus ?? 0)).toEqual([1, 0])
    expect(scorer(aggregateWeeklyStats([ONE, FOUR], normalizeNhlGameStats).stats)).toBe(3)
    // Per week it would be 5 GA in 120 minutes = 2.50, which is not below 2.50: no bonus.
    expect((5 * 60) / 120).toBe(2.5)
  })

  it('needs the goalie\'s minutes: a line ingested without them earns nothing', () => {
    const noMinutes = { group: 'goalies', stats: { saves: 30, shots_against: 30, goals_allowed: 0 } }
    expect(normalizeNhlGameStats(noMinutes).stats.g_gaa_bonus).toBeUndefined()
  })

  it('is a goalie bonus only — a skater line never carries it', () => {
    expect(normalizeNhlGameStats(skaterLine(1, 3)).stats.g_gaa_bonus).toBeUndefined()
  })
})

describe('shooting % bonus — per game', () => {
  it('1 goal on 4 shots is 15 points over 10%; 0 on 6 earns nothing; the week is not 10%', () => {
    const scorer = scorerFor({ shooting_pct_bonus: 1 })
    const lines = [skaterLine(1, 4), skaterLine(0, 6)]
    expect(lines.map((l) => normalizeNhlGameStats(l).stats.sh_pct_bonus)).toEqual([15, undefined])
    // Per week, 1 on 10 is exactly 10%: nothing. Per game it is 15.
    expect(scorer(aggregateWeeklyStats(lines, normalizeNhlGameStats).stats)).toBeCloseTo(15, 9)
  })

  it('no shots, no bonus', () => {
    expect(normalizeNhlGameStats(skaterLine(0, 0)).stats.sh_pct_bonus).toBeUndefined()
  })
})

describe('the rows stay gated until a commissioner saves on the current contract', () => {
  it('an unsaved (seeded) store does not score them', () => {
    const settings = nhlSettings({ save_pct_bonus: 1, gaa_bonus: 3, shooting_pct_bonus: 1 })
    delete (settings.nhl_scoring_config as Record<string, unknown>).lastUpdatedBy
    const scorer = buildLeagueStatScorer({ sport: 'NHL', settings })!
    const stats = normalizeNhlGameStats(goalieLine(29, 30, 1)).stats
    expect(stats.g_sv_pct_bonus).toBeGreaterThan(0)
    expect(stats.g_gaa_bonus).toBe(1)
    expect(scorer(stats)).toBe(0)
  })
})

/*
 * End to end through the sync (per-game rows -> weekly + per-day stats) and the matchup scorer that
 * both the live recalculation and the week finalizer run (`scoreRosterForWeek`).
 */
describe('weekly vs daily leagues, through the sync and the matchup scorer', () => {
  const RULES = { save_pct_bonus: 1, gaa_bonus: 3 }
  const DAILY = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
  const GAMES = [
    // Wed 30 Sep: .940, GAA 3.00 → 4 save-% steps.
    { playerId: 'g1', gameDate: day('2026-09-30'), normalizedStatMap: GOOD },
    // Fri 2 Oct: .967, GAA 1.00 → 6.67 steps + the GAA bonus.
    { playerId: 'g1', gameDate: day('2026-10-02'), normalizedStatMap: goalieLine(29, 30, 1) },
    // Sun 4 Oct: .880, GAA 6.00 → nothing.
    { playerId: 'g1', gameDate: day('2026-10-04'), normalizedStatMap: BAD },
  ]

  type Upsert = { create: { stats: Record<string, number>; scoringDay?: Date } }

  async function sync(settings: unknown) {
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
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'r1' }])
    db.redraftSeason.findFirst.mockResolvedValue({ id: 'season-1', leagueId: 'L1', sport: 'NHL', season: 2026, currentWeek: 1 })
    db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'g1', sport: 'NHL', position: 'G', team: 'TOR' }])
    db.playerGameStat.findMany.mockResolvedValue(GAMES.map((g) => ({ ...g, sportType: 'NHL', season: 2026 })))
    db.league.findFirst.mockResolvedValue({ sport: 'NHL', settings })
    db.league.findUnique.mockResolvedValue({ platform: 'allfantasy', survivorMode: false, settings })
    const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1', week: 1, actorId: 'admin-1' })
    const weekly = (db.playerWeeklyScore.upsert.mock.calls as Array<[Upsert]>).map((c) => c[0].create.stats)
    const daily = (db.playerDailyScore.upsert.mock.calls as Array<[Upsert]>).map((c) => c[0].create)
    return { weekly, daily }
  }

  /** Score the roster from exactly what the sync wrote, with the goalie started on `startedDays`. */
  async function score(settings: unknown, written: Awaited<ReturnType<typeof sync>>, startedDays: string[] | null) {
    db.league.findFirst.mockResolvedValue({ sport: 'NHL', settings })
    db.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: 'g1', rosterId: 'r1', sport: 'NHL', position: 'G', slotType: startedDays ? 'BN' : 'G', droppedAt: null, addedAt: day('2026-09-01') },
    ])
    db.roster.findMany.mockResolvedValue([])
    db.afRosterLineupAssignment.findMany.mockResolvedValue([])
    db.redraftDailyLineup.findMany.mockResolvedValue(
      ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((d) => ({
        rosterId: 'r1',
        playerId: 'g1',
        scoringDay: day(d),
        slotType: startedDays?.includes(d) ? 'G' : 'BN',
      })),
    )
    db.playerDailyScore.findMany.mockResolvedValue(
      written.daily.map((d) => ({ playerId: 'g1', scoringDay: d.scoringDay, stats: d.stats, isFinalized: true })),
    )
    db.playerWeeklyScore.findUnique.mockResolvedValue({ stats: written.weekly[0], isFinalized: true })
    return (await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })).points
  }

  beforeEach(() => vi.clearAllMocks())

  it('weekly lineups: every game counts, each evaluated on its own', async () => {
    const settings = nhlSettings(RULES)
    const written = await sync(settings)
    expect(written.weekly).toHaveLength(1)
    expect(written.daily).toHaveLength(0) // not a daily-lineup league
    expect(written.weekly[0].g_sv_pct_bonus).toBeCloseTo(4 + 20 / 3, 9)
    expect(written.weekly[0].g_gaa_bonus).toBe(1)
    // 4 + 6.67 save-% steps + one 3-point GAA game. Per week (.911, GAA 3.33) it would be 1.1 + 0.
    expect(await score(settings, written, null)).toBe(Math.round((4 + 20 / 3 + 3) * 100) / 100)
  })

  it('daily lineups: only the started games count', async () => {
    const settings = nhlSettings(RULES, DAILY)
    const written = await sync(settings)
    expect(written.daily.map((d) => d.scoringDay?.toISOString().slice(0, 10))).toEqual(['2026-09-30', '2026-10-02', '2026-10-04'])

    // Started only on the .880 Sunday: no bonus at all, though his week holds two bonus games.
    expect(await score(settings, written, ['2026-10-04'])).toBe(0)
    // Started on the .940 Wednesday and the .880 Sunday: exactly the Wednesday bonus.
    expect(await score(settings, written, ['2026-09-30', '2026-10-04'])).toBe(4)
    // Started Friday only: its save-% steps and its GAA bonus.
    expect(await score(settings, written, ['2026-10-02'])).toBe(Math.round((20 / 3 + 3) * 100) / 100)
  })
})
