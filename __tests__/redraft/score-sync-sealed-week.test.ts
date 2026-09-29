import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A ROUTINE SCORE-SYNC TICK UN-SEALED A WEEK THE FINALIZER HAD ALREADY SEALED — EVERY FIVE MINUTES.
 *
 * Measured on production 2026-09-29: NFL week 3 sealed at 12:17 UTC and both native NFL leagues rolled
 * to week 4, but every score-sync run after that reported `weeksFinalized` for it again. The route
 * reconciles the week the NFL calendar still calls current (3, until week 4 kicks off), and the stat
 * sync's upserts write `isFinalized: false`; the recalculation then drops the matchups to 'active'
 * and the standings drop the week, and seconds later the sweep seals it all again.
 *
 * This runs ONE real tick through the real route and the real week finalizer. Only the edges are fake:
 * a small in-memory database that honours the queries it is asked, a stat sync that writes rows the way
 * the real upserts do (`isFinalized: false`), and a recalculation that marks a matchup final only when
 * every starter's row is sealed — which is the real rule (`updateMatchupScores`' `allFinal`).
 */

type Matchup = { id: string; seasonId: string; week: number; status: string; awayRosterId: string | null; homeRosterId: string }
type Score = { playerId: string; sport: string; week: number; season: number; isFinalized: boolean }

const db = vi.hoisted(() => ({
  matchups: [] as Matchup[],
  scores: [] as Score[],
  syncCalls: [] as Array<{ seasonId: string; week: number }>,
  standingsCalls: [] as Array<[string, number]>,
}))

const matchesWeek = (w: unknown, week: number): boolean => {
  if (w == null) return true
  if (typeof w === 'number') return w === week
  const r = w as { gte?: number; lte?: number }
  return (r.gte == null || week >= r.gte) && (r.lte == null || week <= r.lte)
}

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/adminAuth', () => ({ requireAdminOrBearer: vi.fn() }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_meta: unknown, fn: () => Promise<unknown>, summarize: (r: unknown) => unknown) => {
    const r = await fn()
    return { result: r, summary: summarize(r) }
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => ({ bestBallMode: false, leagueType: 'redraft', leagueVariant: null })) },
    zombieLeague: { findMany: vi.fn(async () => []) },
    c2CLeague: { findMany: vi.fn(async () => []) },
    redraftSeason: {
      findMany: vi.fn(async () => [{ id: 'season-1', leagueId: 'league-1', sport: 'NFL', status: 'active', league: {} }]),
      findFirst: vi.fn(async () => ({ id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026 })),
    },
    redraftMatchup: {
      findMany: vi.fn(async ({ where }: { where: Record<string, any> }) =>
        db.matchups.filter(
          (m) =>
            m.seasonId === where.seasonId &&
            matchesWeek(where.week, m.week) &&
            (where.status?.not == null || m.status !== where.status.not) &&
            (where.awayRosterId?.not !== null || m.awayRosterId != null),
        ),
      ),
    },
    sportsGame: {
      findMany: vi.fn(async () => [
        { status: 'final', startTime: new Date('2026-09-21T20:15:00Z'), source: 'espn', fetchedAt: new Date('2026-09-22T08:00:00Z'), season: 2026, week: 3, homeTeam: 'A', awayTeam: 'B', seasonType: 'regular' },
      ]),
    },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'r1' }, { id: 'r2' }]) },
    redraftRosterPlayer: {
      findMany: vi.fn(async () => [
        { rosterId: 'r1', playerId: 'p1', sport: 'NFL', slotType: 'QB', position: 'QB' },
        { rosterId: 'r2', playerId: 'p2', sport: 'NFL', slotType: 'QB', position: 'QB' },
      ]),
    },
    roster: { findMany: vi.fn(async () => []) },
    afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
    playerWeeklyScore: {
      findMany: vi.fn(async ({ where }: { where: Record<string, any> }) =>
        db.scores.filter((s) => s.week === where.week && s.season === where.season && where.playerId.in.includes(s.playerId)),
      ),
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: { isFinalized: boolean } }) => {
        let count = 0
        for (const s of db.scores) {
          if (s.week === where.week && s.season === where.season && where.playerId.in.includes(s.playerId) && s.isFinalized === where.isFinalized) {
            s.isFinalized = data.isFinalized
            count += 1
          }
        }
        return { count }
      }),
    },
  },
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ syncWeeklyScores: vi.fn() }))
vi.mock('@/lib/zombie/matchupCompletion', () => ({ checkAllMatchupsComplete: vi.fn() }))
vi.mock('@/lib/zombie/weeklyResolutionEngine', () => ({ runWeeklyResolution: vi.fn() }))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ getZombieLeagueConfig: vi.fn() }))
vi.mock('@/lib/zombie/zombieAutomation', () => ({ runZombieHousekeeping: vi.fn(async () => ({ leaguesChecked: 0, announcementsPosted: 0, errors: [] })) }))
vi.mock('@/lib/guillotine/nativeGuillotineWeek', () => ({ runNativeGuillotineWeek: vi.fn(async () => ({ outcome: 'not_guillotine' })) }))
vi.mock('@/lib/bestball/nativeTournament', () => ({ runNativeTournamentWeek: vi.fn() }))
vi.mock('@/lib/playoff-runtime/playoffRoundScoring', () => ({ scoreActivePlayoffRound: vi.fn() }))
vi.mock('@/lib/redraft/scoreSyncBatch', () => ({ rotatingBatch: <T,>(xs: T[]) => xs, SCORE_SYNC_BATCH: 50 }))
vi.mock('@/lib/season-week', () => ({
  // The NFL calendar still calls week 3 current — the production shape until week 4 kicks off.
  resolveSeasonWeekForRedraftSeason: vi.fn(async () => ({ ok: true, phase: 'regular', fantasyWeek: 3 })),
}))
vi.mock('@/lib/redraft/playerWeeklyScoreService', () => ({
  // The real upserts write `isFinalized: false` for every row they touch.
  syncPlayerWeeklyScoresForRedraftSeason: vi.fn(async ({ seasonId, week }: { seasonId: string; week: number }) => {
    db.syncCalls.push({ seasonId, week })
    for (const s of db.scores) if (s.week === week) s.isFinalized = false
    return { seasonId, week }
  }),
}))
vi.mock('@/lib/redraft/scoringEngine', async (importOriginal) => ({
  // The finalizer uses the real lineup helpers (`countsTowardScore`, `leagueIsBestBall`); only the
  // matchup recalculation is replaced.
  ...(await importOriginal<typeof import('@/lib/redraft/scoringEngine')>()),
  // The real rule: a matchup is final only when every starter's row for the week is sealed.
  recalculateMatchupsForSeasonWeek: vi.fn(async (seasonId: string, week: number) => {
    const sealed = db.scores.filter((s) => s.week === week).every((s) => s.isFinalized)
    let updated = 0
    for (const m of db.matchups) {
      if (m.seasonId !== seasonId || m.week !== week || m.awayRosterId == null) continue
      m.status = sealed ? 'final' : 'active'
      updated += 1
    }
    return { updated, incomplete: sealed ? 0 : updated, summaries: [] }
  }),
}))
vi.mock('@/lib/redraft/standingsEngine', () => ({
  updateStandings: vi.fn(async (seasonId: string, week: number) => {
    db.standingsCalls.push([seasonId, week])
    return { seasonId, week, rostersUpdated: 2, matchupsCounted: 1 }
  }),
}))

import { GET } from '@/app/api/redraft/score-sync/route'

async function tick() {
  const res = await GET(new Request('http://localhost/api/redraft/score-sync'))
  return (await res.json()) as { result: { redraft: Record<string, any> } }
}

beforeEach(() => {
  delete process.env.REDRAFT_WEEK_FINALIZER_DISABLED
  db.syncCalls.length = 0
  db.standingsCalls.length = 0
  // Week 3, already SEALED by the finalizer: one real matchup final, a bye still 'scheduled' (#1561),
  // every starter's row sealed.
  db.matchups = [
    { id: 'm1', seasonId: 'season-1', week: 3, status: 'final', homeRosterId: 'r1', awayRosterId: 'r2' },
    { id: 'bye', seasonId: 'season-1', week: 3, status: 'scheduled', homeRosterId: 'r3', awayRosterId: null },
  ]
  db.scores = [
    { playerId: 'p1', sport: 'NFL', week: 3, season: 2026, isFinalized: true },
    { playerId: 'p2', sport: 'NFL', week: 3, season: 2026, isFinalized: true },
  ]
})

describe('score-sync leaves a sealed week sealed', () => {
  it('one routine tick: rows stay sealed, matchups stay final, and nothing is re-sealed', async () => {
    const body = await tick()

    expect(db.scores.every((s) => s.isFinalized)).toBe(true)
    expect(db.matchups.find((m) => m.id === 'm1')!.status).toBe('final')
    expect(body.result.redraft.weeksFinalized).toBe(0)
    // The stat sync never touched the sealed week.
    expect(db.syncCalls).toEqual([])
  })

  it('says so in the telemetry, so a quiet tick is not read as a stalled one', async () => {
    const body = await tick()

    expect(body.result.redraft.skippedSealedWeek).toBe(1)
    expect(body.result.redraft.reconciled).toBe(0)
  })

  it('still reconciles a week that is NOT sealed', async () => {
    db.matchups[0]!.status = 'active'
    db.scores.forEach((s) => (s.isFinalized = false))

    const body = await tick()

    expect(db.syncCalls).toEqual([{ seasonId: 'season-1', week: 3 }])
    expect(body.result.redraft.reconciled).toBe(1)
    // …and the sweep then seals it, exactly once.
    expect(body.result.redraft.weeksFinalized).toBe(1)
    expect(db.matchups.find((m) => m.id === 'm1')!.status).toBe('final')
  })
})
