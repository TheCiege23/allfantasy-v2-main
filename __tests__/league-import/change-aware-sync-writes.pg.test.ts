/**
 * @vitest-environment node
 *
 * The change-aware writers' SQL, run against a REAL Postgres.
 *
 * The unit suites mock `$executeRaw`, so they prove which rows are SENT and that the statement says
 * the right things — not that Postgres accepts it or that its `IS DISTINCT FROM` guard behaves.
 * This suite runs the exact statements the writers build against a scratch database.
 *
 * 🛑 OPT-IN, AND IT NAMES ITS OWN TARGET. It runs only when `AF_SCRATCH_PG_URL` is set, and it
 * creates and drops its own tables, so point it at a throwaway database ONLY — never one holding
 * data. It never reads DATABASE_URL (see vitest.setup.db-guard.ts for why that matters here).
 *
 *   AF_SCRATCH_PG_URL=postgres://user:pass@127.0.0.1:5432/scratch \
 *     node node_modules/vitest/vitest.mjs run __tests__/league-import/change-aware-sync-writes.pg.test.ts
 *
 * Table DDL is copied from prisma/migrations (20260820120000_league_player_weekly_scores and the
 * init migration's team_performances). The team_performances → league_teams foreign key is left
 * out: it constrains which team ids exist, which these statements do not decide.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const PG_URL = process.env.AF_SCRATCH_PG_URL
const h = vi.hoisted(() => ({ client: null as null | { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> } }))

/** A tagged-template call → `$1…$n` text + values, the same parameterisation Prisma performs. */
function toQuery(strings: TemplateStringsArray | string[], values: unknown[]) {
  let text = strings[0]
  for (let i = 1; i < strings.length; i++) text += `$${i}` + strings[i]
  return { text, values }
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: async (strings: string[], ...values: unknown[]) => {
      const q = toQuery(strings, values)
      const res = await h.client!.query(q.text, q.values)
      return res.rowCount ?? 0
    },
    leaguePlayerWeeklyScore: {
      findMany: async ({ where }: any) =>
        (await h.client!.query(
          `SELECT "playerId", "rosterId", points, "isStarter", source FROM league_player_weekly_scores
            WHERE "leagueId" = $1 AND "seasonYear" = $2 AND week = $3`,
          [where.leagueId, where.seasonYear, where.week],
        )).rows,
    },
    teamPerformance: {
      findMany: async ({ where }: any) =>
        (await h.client!.query(
          `SELECT "teamId", week, points, opponent, result FROM team_performances
            WHERE "teamId" = ANY($1) AND season = $2`,
          [where.teamId.in, where.season],
        )).rows,
      upsert: async () => {
        throw new Error('the batch path must not fall back in this suite')
      },
    },
  },
}))

const matchups = vi.hoisted(() => ({ current: [] as unknown[] }))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueMatchups: async () => matchups.current }))

import { ingestSleeperPlayerScoresForWeek } from '@/lib/sleeper/sync/ingestSleeperPlayerScores'
import { writeTeamPerformances, type TeamPerformanceWrite } from '@/lib/league-import/teamPerformanceWrites'

const suite = PG_URL ? describe : describe.skip

suite('change-aware writes against Postgres', () => {
  beforeAll(async () => {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: PG_URL })
    await client.connect()
    h.client = client as never
    await client.query(`DROP TABLE IF EXISTS league_player_weekly_scores; DROP TABLE IF EXISTS team_performances;`)
    await client.query(`
      CREATE TABLE "league_player_weekly_scores" (
        "id" TEXT NOT NULL, "leagueId" VARCHAR(64) NOT NULL, "seasonYear" INTEGER NOT NULL,
        "week" INTEGER NOT NULL, "playerId" VARCHAR(64) NOT NULL, "rosterId" INTEGER,
        "isStarter" BOOLEAN NOT NULL DEFAULT false, "points" DOUBLE PRECISION NOT NULL,
        "isFinalized" BOOLEAN NOT NULL DEFAULT false, "source" VARCHAR(16) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "league_player_weekly_scores_pkey" PRIMARY KEY ("id"));
      CREATE UNIQUE INDEX "league_player_weekly_scores_leagueId_seasonYear_week_playerId_key"
        ON "league_player_weekly_scores"("leagueId", "seasonYear", "week", "playerId");
      CREATE TABLE "team_performances" (
        "id" TEXT NOT NULL, "teamId" TEXT NOT NULL, "week" INTEGER NOT NULL, "season" INTEGER NOT NULL,
        "points" DOUBLE PRECISION NOT NULL, "opponent" TEXT, "result" TEXT, "data" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "team_performances_pkey" PRIMARY KEY ("id"));
      CREATE UNIQUE INDEX "team_performances_teamId_season_week_key" ON "team_performances"("teamId", "season", "week");
    `)
  })
  afterAll(async () => {
    await h.client?.query(`DROP TABLE IF EXISTS league_player_weekly_scores; DROP TABLE IF EXISTS team_performances;`)
    await (h.client as unknown as { end: () => Promise<void> } | null)?.end()
  })
  beforeEach(async () => {
    await h.client!.query(`TRUNCATE league_player_weekly_scores, team_performances`)
  })

  const rows = async () =>
    (await h.client!.query(
      `SELECT "playerId", points, "rosterId", "isStarter", "isFinalized", "updatedAt", id FROM league_player_weekly_scores ORDER BY "playerId"`,
    )).rows

  const week = (p1: number) => [{
    matchup_id: 1, roster_id: 7, points: p1 + 12.4,
    starters: ['p1', 'p2'], starters_points: [p1, 12.4],
    players: ['p1', 'p2', 'p3'], players_points: { p1, p2: 12.4, p3: 3.1 },
  }]

  describe('league_player_weekly_scores', () => {
    it('inserts a new week, then an identical re-sync touches no row', async () => {
      matchups.current = week(20.5)
      const first = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(first).toMatchObject({ scoresUpserted: 3, error: null })
      const before = await rows()
      expect(before.map((r) => [r.playerId, r.points, r.rosterId, r.isStarter, r.isFinalized])).toEqual([
        ['p1', 20.5, 7, true, false], ['p2', 12.4, 7, true, false], ['p3', 3.1, 7, false, false],
      ])

      const second = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(second).toMatchObject({ scoresUpserted: 0, scoresUnchanged: 3, error: null })
      const after = await rows()
      expect(after.map((r) => r.updatedAt.getTime())).toEqual(before.map((r) => r.updatedAt.getTime()))
    })

    it('keeps a sealed score sealed when the provider still reports it identically', async () => {
      matchups.current = week(20.5)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      await h.client!.query(`UPDATE league_player_weekly_scores SET "isFinalized" = true`)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect((await rows()).every((r) => r.isFinalized)).toBe(true)
    })

    it('a real correction updates exactly that row, makes it provisional, and keeps its id', async () => {
      matchups.current = week(20.5)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      await h.client!.query(`UPDATE league_player_weekly_scores SET "isFinalized" = true`)
      const ids = (await rows()).map((r) => r.id)

      matchups.current = week(22.5)
      const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(r).toMatchObject({ scoresUpserted: 1, scoresUnchanged: 2 })
      const after = await rows()
      expect(after.map((x) => x.id)).toEqual(ids)
      expect(after.map((x) => [x.playerId, x.points, x.isFinalized])).toEqual([
        ['p1', 22.5, false], ['p2', 12.4, true], ['p3', 3.1, true],
      ])
    })

    it('the statement itself declines a row that is already current (stale read)', async () => {
      matchups.current = week(20.5)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      await h.client!.query(`UPDATE league_player_weekly_scores SET "isFinalized" = true`)
      /*
       * Simulate a read taken before another writer brought the row up to date: the writer believes
       * p1 is missing and sends it, with the values that are by now already stored.
       */
      const { prisma } = await import('@/lib/prisma')
      const original = prisma.leaguePlayerWeeklyScore.findMany
      ;(prisma.leaguePlayerWeeklyScore as any).findMany = async () => []
      try {
        const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
        expect(r.scoresUpserted).toBe(0)
      } finally {
        ;(prisma.leaguePlayerWeeklyScore as any).findMany = original
      }
      expect((await rows()).every((x) => x.isFinalized)).toBe(true)
    })

    it('a starter/bench move is written', async () => {
      matchups.current = week(20.5)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      matchups.current = [{ ...week(20.5)[0], starters: ['p1', 'p3'], starters_points: [20.5, 3.1] }]
      const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(r.scoresUpserted).toBe(2)
      expect((await rows()).map((x) => [x.playerId, x.isStarter])).toEqual([['p1', true], ['p2', false], ['p3', true]])
    })
  })

  describe('team_performances', () => {
    const tp = async () =>
      (await h.client!.query(`SELECT "teamId", week, points, opponent, result FROM team_performances ORDER BY "teamId", week`)).rows
    const schedule: TeamPerformanceWrite[] = [
      { teamId: 't1', week: 1, points: 100, opponent: 't2', result: 'W' },
      { teamId: 't2', week: 1, points: 90, opponent: 't1', result: 'L' },
    ]

    it('inserts, then an identical schedule writes nothing', async () => {
      expect((await writeTeamPerformances({ season: 2026, rows: schedule })).written).toBe(2)
      const again = await writeTeamPerformances({ season: 2026, rows: schedule })
      expect(again).toMatchObject({ changed: 0, written: 0 })
      expect(await tp()).toEqual([
        { teamId: 't1', week: 1, points: 100, opponent: 't2', result: 'W' },
        { teamId: 't2', week: 1, points: 90, opponent: 't1', result: 'L' },
      ])
    })

    it('an unresolved opponent and a missing result keep the stored values', async () => {
      await writeTeamPerformances({ season: 2026, rows: schedule })
      const out = await writeTeamPerformances({
        season: 2026,
        rows: [{ teamId: 't1', week: 1, points: 101, opponent: null, result: null }],
      })
      expect(out.written).toBe(1)
      expect((await tp())[0]).toEqual({ teamId: 't1', week: 1, points: 101, opponent: 't2', result: 'W' })
    })

    it('the statement declines a row that is already current', async () => {
      await writeTeamPerformances({ season: 2026, rows: schedule })
      const { prisma } = await import('@/lib/prisma')
      const original = prisma.teamPerformance.findMany
      ;(prisma.teamPerformance as any).findMany = async () => []
      try {
        expect((await writeTeamPerformances({ season: 2026, rows: schedule })).written).toBe(0)
      } finally {
        ;(prisma.teamPerformance as any).findMany = original
      }
    })
  })
})
