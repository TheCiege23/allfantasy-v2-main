/**
 * Phase 1 of Pro-Style Playoffs: daily scoring proven on the one live NHL redraft season.
 *
 * Every number below is PRODUCTION data, read-only, on 2026-10-25 (Neon icy-field-51189449): league
 * d41382f9 "NHL Season Verification", season cmufll2hk00hf4iy1d7b21feu, week 3 (13-19 Oct 2026). The
 * stat lines are the `player_game_stats.normalized_stat_map` rows exactly as stored, the roster rows
 * are the league's own, and the scoring weights are its `nhl_scoring_config`. Only the per-day lineup
 * gate (`sportConfig`) is added — production has the league on weekly lineups.
 *
 * The expected points are worked BY HAND from those weights, not from the engine, so the engine is
 * checked against something it did not produce. ⚠ The stored panel also carries faceoff wins 0.1,
 * faceoff losses -0.05 and a hat trick 2, but nobody has saved it since those rows were wired, so they
 * score 0 by design (`nhlStoreScoresGatedKeys`, lib/nhl-scoring/nhlScoringEngineContract.ts). The first
 * hand calculation included them and missed by exactly the faceoff points (0.75 and 0.50):
 *
 *   13 Oct  Adam Fox (D)       A2 4, +/-2 2, SOG1 0.5, HIT1 0.3, BLK4 2, PIM2 -0.5, SHP1 1   =  9.30
 *           Adam Fantilli (C)  +/-1 1, SOG2 1, HIT1 0.3, BLK1 0.5                         =  2.80
 *           Adam Edstrom (C)   G1 3, HIT4 1.2, BLK2 1, +/- -1 -1, SOG1 0.5, SHP1 1            =  5.70
 *           Aaron Ekblad (D)   BLK2 1, +/- -2 -2, SOG2 1                                     =  0.00
 *   17 Oct  Fox                SOG2 1                                                        =  1.00
 *           Fantilli           HIT1 0.3, BLK1 0.5, SOG5 2.5, PIM2 -0.5                       =  2.80
 *           Edstrom            HIT8 2.4, G1 3, BLK1 0.5, +/-1 1, SOG3 1.5, SHP1 1            =  9.40
 *           Ekblad             HIT2 0.6, BLK1 0.5                                            =  1.10
 *
 * Fox, Fantilli and Ekblad are `tsdb_…` roster ids. Before the name bridge they found no game log and
 * scored 0 every week (production week 3: cj_759's Team 0, Open Team 4 17.8 from Edstrom alone).
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

import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const LEAGUE = 'd41382f9-6700-475d-ac8c-041632dd0a33'
const SEASON = 'cmufll2hk00hf4iy1d7b21feu'
const CJ = 'cmufll2mg00hh4iy1swmcacjc' // cj_759's Team
const OT4 = 'cmufll2vv00ht4iy1q5hyzbv0' // Open Team 4

/** The league's stored scoring, verbatim, plus the per-day lineup gate. */
const SETTINGS = {
  sport_type: 'NHL',
  scoring_mode: 'points',
  scoring_preset_id: 'nhl_points',
  scoringSettings: { rules: [], sport: 'NHL', preset: 'nhl_points', modifiers: [], defaultMode: 'points', categoryType: 'points', scoringFormat: 'standard', scoringTemplateId: 'nhl_points' },
  nhl_scoring_config: {
    rules: {
      hits: 0.3, goals: 3, saves: 0.2, points: 0, assists: 2, shutouts: 2, gaa_bonus: 0, giveaways: 0, takeaways: 0,
      plus_minus: 1, goalie_wins: 3, faceoff_wins: 0.1, goalie_goals: 0, blocked_shots: 0.5, goalie_losses: 0,
      goals_against: -1, shots_against: 0, shots_on_goal: 0.5, faceoff_losses: -0.05, goalie_assists: 0,
      overtime_goals: 0, save_pct_bonus: 0, hat_trick_bonus: 2, overtime_losses: 0, penalty_minutes: -0.25,
      power_play_goals: 0, power_play_points: 0.5, game_winning_goals: 1, power_play_assists: 0,
      shooting_pct_bonus: 0, short_handed_goals: 0, short_handed_points: 1, short_handed_assists: 0,
      goalie_minutes_played: 0, goalie_penalty_minutes: 0, empty_net_goals_against: 0, gordie_howe_hat_trick_bonus: 0,
    },
    source: 'AF_DEFAULT',
    presetKey: 'af_default',
    matchesPreset: true,
  },
  sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true },
}

const ADDED = new Date('2026-09-24T13:58:48.000Z')
/** The two rosters' rows that matter, as stored (slot = the weekly lineup in force all week). */
const ROSTER_PLAYERS = [
  { rosterId: CJ, playerId: 'tsdb_34176537', playerName: 'Adam Fox', position: 'D', team: 'New York Rangers', slotType: 'D' },
  { rosterId: CJ, playerId: 'tsdb_34220053', playerName: 'Adam Fantilli', position: 'C', team: 'Columbus Blue Jackets', slotType: 'C' },
  { rosterId: CJ, playerId: '854', playerName: 'Aaron Ness', position: 'D', team: 'Washington Capitals', slotType: 'D' },
  { rosterId: CJ, playerId: '1281', playerName: 'Alex Formenton', position: 'LW', team: 'Edmonton Oilers', slotType: 'bench' },
  { rosterId: OT4, playerId: '3142', playerName: 'Adam Edstrom', position: 'C', team: 'Nashville Predators', slotType: 'C' },
  // The old pool listed Edstrom twice; this league drafted both copies onto the same team.
  { rosterId: OT4, playerId: 'tsdb_34185172', playerName: 'Adam Edström', position: 'C', team: 'Nashville Predators', slotType: 'C' },
  { rosterId: OT4, playerId: 'tsdb_34160301', playerName: 'Aaron Ekblad', position: 'D', team: 'Florida Panthers', slotType: 'D' },
  { rosterId: OT4, playerId: 'tsdb_34202901', playerName: 'Akira Schmid', position: 'G', team: 'Florida Panthers', slotType: 'bench' },
].map((p) => ({ ...p, sport: 'NHL', addedAt: ADDED, droppedAt: null, isLocked: false }))

/** PlayerIdentityMap rows (sport NHL) those roster ids reach. */
const IDENTITIES = [
  { id: '0a198b16-f16f-44aa-acd5-d23fdded8825', rollingInsightsId: '2359', sleeperId: null, normalizedName: 'adam fox' },
  { id: '5c534ebf-4f86-481f-8596-6eef9109d0cf', rollingInsightsId: '3533', sleeperId: null, normalizedName: 'adam fantilli' },
  { id: 'e7044e7c-5814-48bb-8872-bf66d082b978', rollingInsightsId: '1281', sleeperId: null, normalizedName: 'alex formenton' },
  { id: '1c0124d6-695c-4dbc-b882-a6442acff757', rollingInsightsId: '3142', sleeperId: null, normalizedName: 'adam edstrom' },
  { id: 'a6b13833-fbdb-4375-b540-2967aa4b510a', rollingInsightsId: '298', sleeperId: null, normalizedName: 'aaron ekblad' },
  { id: '5e29404b-ccbb-4c21-9ef0-9e231c8395f6', rollingInsightsId: '1789', sleeperId: null, normalizedName: 'akira schmid' },
  // Production: status INACT, no game all season (RI id 854).
  { id: 'pim-ness', rollingInsightsId: '854', sleeperId: null, normalizedName: 'aaron ness', status: 'INACT', currentTeam: 'WASHINGTON CAPITALS' },
]

const sk = (s: Record<string, number>) => ({
  hits: 0, goals: 0, blocks: 0, assists: 0, giveaways: 0, takeaways: 0, plus_minus: 0, faceoffs_won: 0, faceoffs_lost: 0,
  shots_on_goal: 0, shootout_goals: 0, penalty_minutes: 0, power_play_goals: 0, power_play_assists: 0,
  short_handed_goals: 0, short_handed_assists: 0, ...s,
})
const line = (group: 'skaters' | 'goalies', position: string, stats: Record<string, number>) => ({
  group, stats, scored: false, status: 'ACT', position, seasonType: 'regular', seasonTypeLabel: 'Regular Season',
})
/** `player_game_stats` rows, 13 and 17 Oct 2026, verbatim. */
const GAME_ROWS = [
  ['0a198b16-f16f-44aa-acd5-d23fdded8825', '2026-10-13', line('skaters', 'D', sk({ hits: 1, blocks: 4, assists: 2, giveaways: 2, plus_minus: 2, shots_on_goal: 1, penalty_minutes: 2, short_handed_assists: 1 }))],
  ['5c534ebf-4f86-481f-8596-6eef9109d0cf', '2026-10-13', line('skaters', 'C', sk({ hits: 1, blocks: 1, plus_minus: 1, faceoffs_won: 13, faceoffs_lost: 11, shots_on_goal: 2 }))],
  ['e7044e7c-5814-48bb-8872-bf66d082b978', '2026-10-13', line('skaters', 'LW', sk({ hits: 1, blocks: 1, faceoffs_lost: 1, shots_on_goal: 1 }))],
  ['1c0124d6-695c-4dbc-b882-a6442acff757', '2026-10-13', line('skaters', 'C', sk({ hits: 4, goals: 1, blocks: 2, giveaways: 1, plus_minus: -1, shots_on_goal: 1, short_handed_goals: 1 }))],
  ['a6b13833-fbdb-4375-b540-2967aa4b510a', '2026-10-13', line('skaters', 'D', sk({ blocks: 2, giveaways: 1, takeaways: 1, plus_minus: -2, shots_on_goal: 2 }))],
  ['5e29404b-ccbb-4c21-9ef0-9e231c8395f6', '2026-10-13', line('goalies', 'G', { win: 1, loss: 0, saves: 24, shutouts: 0, goals_allowed: 3, overtime_loss: 0, shots_against: 27 })],
  ['0a198b16-f16f-44aa-acd5-d23fdded8825', '2026-10-17', line('skaters', 'D', sk({ giveaways: 2, shots_on_goal: 2 }))],
  ['5c534ebf-4f86-481f-8596-6eef9109d0cf', '2026-10-17', line('skaters', 'C', sk({ hits: 1, blocks: 1, giveaways: 1, faceoffs_won: 9, faceoffs_lost: 8, shots_on_goal: 5, penalty_minutes: 2 }))],
  ['e7044e7c-5814-48bb-8872-bf66d082b978', '2026-10-17', line('skaters', 'LW', sk({ hits: 3, blocks: 1, shots_on_goal: 1 }))],
  ['1c0124d6-695c-4dbc-b882-a6442acff757', '2026-10-17', line('skaters', 'C', sk({ hits: 8, goals: 1, blocks: 1, plus_minus: 1, faceoffs_lost: 1, shots_on_goal: 3, short_handed_goals: 1 }))],
  ['a6b13833-fbdb-4375-b540-2967aa4b510a', '2026-10-17', line('skaters', 'D', sk({ hits: 2, blocks: 1, giveaways: 1 }))],
] as const

/** The hand-computed starter points per roster per day (header of this file). */
const HAND = {
  '2026-10-13': { [CJ]: 9.3 + 2.8, [OT4]: 5.7 + 0 },
  '2026-10-17': { [CJ]: 1 + 2.8, [OT4]: 9.4 + 1.1 },
} as const

type DailyRow = { playerId: string; sport: string; season: number; week: number; scoringDay: Date; stats: Record<string, number>; isFinalized: boolean }
let dailyStore: DailyRow[] = []
let weeklyStore = new Map<string, { stats: Record<string, number>; fantasyPts: number; isFinalized: boolean }>()

function arrange(days: readonly string[], dailyLineups: Array<{ rosterId: string; playerId: string; scoringDay: Date; slotType: string }> = []) {
  vi.clearAllMocks()
  dailyStore = []
  weeklyStore = new Map()
  db.adminAuditLog.create.mockResolvedValue({ id: 'audit' })
  db.league.findFirst.mockResolvedValue({ sport: 'NHL', settings: SETTINGS })
  db.league.findUnique.mockResolvedValue({ platform: 'allfantasy', survivorMode: false, settings: SETTINGS })
  db.redraftSeason.findFirst.mockResolvedValue({ id: SEASON, leagueId: LEAGUE, sport: 'NHL', season: 2026, currentWeek: 1 })
  db.redraftRoster.findMany.mockResolvedValue([{ id: CJ }, { id: OT4 }])
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: string | { in: string[] } } }) => {
    const ids = typeof where.rosterId === 'string' ? [where.rosterId] : where.rosterId.in
    return ROSTER_PLAYERS.filter((p) => ids.includes(p.rosterId))
  })
  db.playerIdentityMap.findFirst.mockResolvedValue(null)
  db.playerIdentityMap.findMany.mockImplementation(async ({ where }: { where: Record<string, { in: string[] }> }) => {
    if (where.rollingInsightsId) return IDENTITIES.filter((r) => where.rollingInsightsId.in.includes(r.rollingInsightsId))
    if (where.normalizedName) return IDENTITIES.filter((r) => where.normalizedName.in.includes(r.normalizedName))
    if (where.id) return IDENTITIES.filter((r) => where.id.in.includes(r.id)).map((r) => ({ status: 'ACT', currentTeam: null, ...r }))
    return []
  })
  db.playerGameStat.findMany.mockImplementation(async ({ where }: { where: { playerId: { in: string[] }; gameDate: { gte: Date; lt: Date } } }) =>
    GAME_ROWS.filter(([id, d]) => days.includes(d) && where.playerId.in.includes(id))
      .filter(([, d]) => day(d) >= where.gameDate.gte && day(d) < where.gameDate.lt)
      .map(([playerId, d, map]) => ({ playerId, sportType: 'NHL', season: 2026, gameDate: day(d), normalizedStatMap: map })),
  )
  db.playerGameLogCache.findMany.mockResolvedValue([])
  db.exileWeeklyEntry.findMany.mockResolvedValue([])
  db.sportsGame.findMany.mockResolvedValue([])
  db.sportsPlayer.findFirst.mockResolvedValue(null)
  db.roster.findMany.mockResolvedValue([])
  db.afRosterLineupAssignment.findMany.mockResolvedValue([])
  db.redraftDailyLineup.findMany.mockResolvedValue(dailyLineups)
  db.playerWeeklyScore.upsert.mockImplementation(async ({ create }: { create: { playerId: string; stats: Record<string, number>; fantasyPts: number } }) => {
    weeklyStore.set(create.playerId, { stats: create.stats, fantasyPts: create.fantasyPts, isFinalized: true })
    return {}
  })
  db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) =>
    weeklyStore.get(where.playerId_week_season_sport.playerId) ?? null,
  )
  db.playerDailyScore.upsert.mockImplementation(async ({ create }: { create: DailyRow }) => {
    dailyStore.push({ ...create, isFinalized: false })
    return {}
  })
  db.playerDailyScore.deleteMany.mockResolvedValue({ count: 0 })
  db.playerDailyScore.findMany.mockImplementation(async ({ where }: { where: { playerId: { in: string[] }; scoringDay: { gte: Date; lt: Date } } }) =>
    dailyStore.filter((r) => where.playerId.in.includes(r.playerId) && r.scoringDay >= where.scoringDay.gte && r.scoringDay < where.scoringDay.lt),
  )
}

const round = (n: number) => Math.round(n * 100) / 100

describe('NHL daily scoring, replayed on production week 3', () => {
  beforeEach(() => arrange(['2026-10-13', '2026-10-17']))

  it('the sync bridges the tsdb_ starters by name and refuses the drafted-twice copy', async () => {
    const summary = await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: SEASON, week: 3, actorId: 'test' })
    expect(summary.gameLogIdsBridgedByName).toBe(4) // Fox, Fantilli, Ekblad, Schmid
    expect(summary.warnings.join(' ')).toContain('tsdb_34185172')
    // One row per player per game day, under the ROSTER id; Edstrom's games are credited once.
    const keys = dailyStore.map((r) => `${r.playerId}@${r.scoringDay.toISOString().slice(0, 10)}`).sort()
    expect(keys).toEqual([
      '1281@2026-10-13', '1281@2026-10-17', '3142@2026-10-13', '3142@2026-10-17',
      'tsdb_34160301@2026-10-13', 'tsdb_34160301@2026-10-17', 'tsdb_34176537@2026-10-13', 'tsdb_34176537@2026-10-17',
      'tsdb_34202901@2026-10-13', 'tsdb_34220053@2026-10-13', 'tsdb_34220053@2026-10-17',
    ])
    // The refused copy has no identity, so no evidence: still no row.
    expect(weeklyStore.has('tsdb_34185172')).toBe(false)
    // Inactive all season: a written 0 with no stat line (dailySportParticipation.ts), never a day row.
    expect(weeklyStore.get('854')).toMatchObject({ stats: {}, fantasyPts: 0 })
    expect(summary.dailyZeroScored).toEqual([{ playerId: '854', reason: 'inactive' }])
  })

  for (const [d, byRoster] of Object.entries(HAND)) {
    it(`${d}: each roster's daily starters score what the hand calculation says`, async () => {
      arrange([d])
      await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: SEASON, week: 3, actorId: 'test' })
      for (const [rosterId, expected] of Object.entries(byRoster)) {
        const r = await scoreRosterForWeek({ leagueId: LEAGUE, rosterId, week: 3, seasonYear: 2026 })
        expect({ rosterId, points: r.points }).toEqual({ rosterId, points: round(expected) })
      }
    })
  }

  it('the two days together are the week, and the bench never counts', async () => {
    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: SEASON, week: 3, actorId: 'test' })
    const cj = await scoreRosterForWeek({ leagueId: LEAGUE, rosterId: CJ, week: 3, seasonYear: 2026, includeBench: true })
    const ot4 = await scoreRosterForWeek({ leagueId: LEAGUE, rosterId: OT4, week: 3, seasonYear: 2026 })
    expect(cj.points).toBe(round(9.3 + 2.8 + 1 + 2.8))
    expect(ot4.points).toBe(round(5.7 + 0 + 9.4 + 1.1))
    // Formenton (bench): 13 Oct HIT1 0.3, BLK1 0.5, SOG1 0.5; 17 Oct HIT3 0.9, BLK1 0.5, SOG1 0.5.
    expect(cj.benchPoints).toBe(round(1.3 + 1.9))
    // Ness started and never played, and his identity is INACT: a real 0, so nobody is missing.
    expect(cj.missingPlayerIds).toEqual([])
    expect(cj.scoredStarterCount).toBe(3)
  })

  it('a daily bench move takes only that day off the score', async () => {
    arrange(['2026-10-13', '2026-10-17'], [
      { rosterId: CJ, playerId: 'tsdb_34176537', scoringDay: day('2026-10-17'), slotType: 'BN' },
    ])
    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: SEASON, week: 3, actorId: 'test' })
    const cj = await scoreRosterForWeek({ leagueId: LEAGUE, rosterId: CJ, week: 3, seasonYear: 2026 })
    // Fox's 13 Oct (9.30) counts; his 17 Oct (1.00) does not.
    expect(cj.points).toBe(round(9.3 + 2.8 + 2.8))
  })
})
