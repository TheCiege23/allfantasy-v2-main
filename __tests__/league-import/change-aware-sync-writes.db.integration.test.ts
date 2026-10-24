/**
 * @vitest-environment node
 *
 * The change-aware sync writers, end to end, through the REAL Prisma client against a REAL,
 * fully-migrated Postgres.
 *
 * "Was this row rewritten?" is answered by Postgres itself: every write gives a row a new `xmin`, so
 * an unchanged `xmin` proves no write happened, independent of any mock or counter in our code.
 *
 * 🛑 OPT-IN AND LOCAL-ONLY, FAIL-CLOSED. Runs only when `AF_CHANGE_AWARE_DB_IT=1`, and refuses —
 * throws, never skips — unless DATABASE_URL points at localhost/127.0.0.1. It creates and deletes
 * its own rows. Prepare a throwaway database with the repo's migrations first:
 *
 *   createdb af_it_scratch
 *   DATABASE_URL=postgresql://…@127.0.0.1:5432/af_it_scratch DIRECT_URL=$DATABASE_URL \
 *     node node_modules/prisma/build/index.js migrate deploy
 *   # optional, proves timestamps are UTC whatever the session zone:
 *   psql … -c "ALTER DATABASE af_it_scratch SET timezone = 'America/New_York'"
 *   AF_CHANGE_AWARE_DB_IT=1 DATABASE_URL=… DIRECT_URL=… \
 *     node node_modules/vitest/vitest.mjs run __tests__/league-import/change-aware-sync-writes.db.integration.test.ts
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const OPTED_IN = process.env.AF_CHANGE_AWARE_DB_IT === '1'

const provider = vi.hoisted(() => ({
  matchups: new Map<string, unknown[]>(),
  /** One-shot provider responses, consumed in order before falling back to `matchups`. */
  queue: [] as Array<() => Promise<unknown[]>>,
}))
vi.mock('@/lib/sleeper-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLeagueMatchups: async (leagueId: string, week: number) => {
    const next = provider.queue.shift()
    if (next) return next()
    return provider.matchups.get(`${leagueId}:${week}`) ?? []
  },
}))

import { prisma } from '@/lib/prisma'
import { ingestSleeperPlayerScoresForWeek } from '@/lib/sleeper/sync/ingestSleeperPlayerScores'
import { writeTeamPerformances } from '@/lib/league-import/teamPerformanceWrites'
import { bootstrapLeagueFromNormalizedImport } from '@/lib/league-import/sleeper/SleeperLeagueCreationBootstrapService'
import { ensureMatchupsCached } from '@/lib/rankings-engine/sleeper-matchup-cache'
import { makeSleeperNormalized } from '../fantasy-os/fixtures/sleeperNormalizedFixture'

const STAMP = `it${Date.now().toString(36)}`
const SEASON = 2026
const CUID = /^c[a-z0-9]{24}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const created = { users: [] as string[], leagues: [] as string[], platformLeagueIds: [] as string[] }

function assertLocalDatabase(url: string | undefined) {
  if (!url) throw new Error('[change-aware DB IT] REFUSED: DATABASE_URL is not set')
  const host = new URL(url).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`[change-aware DB IT] REFUSED: DATABASE_URL host "${host}" is not local`)
  }
}

const xmins = async (sql: string, ...params: unknown[]) =>
  (await prisma.$queryRawUnsafe<Array<{ k: string; x: string }>>(sql, ...params))
    .reduce((m, r) => m.set(r.k, r.x), new Map<string, string>())

describe.skipIf(!OPTED_IN)('change-aware sync writes — real Prisma, real Postgres', () => {
  let userId = ''

  beforeAll(async () => {
    assertLocalDatabase(process.env.DATABASE_URL)
    const user = await prisma.appUser.create({ data: { email: `${STAMP}@change-aware.test`, username: STAMP } })
    userId = user.id
    created.users.push(user.id)
  })

  afterEach(() => {
    provider.matchups.clear()
    provider.queue.length = 0
    delete process.env.AF_CHANGE_AWARE_WRITES_OFF
  })

  afterAll(async () => {
    if (!OPTED_IN) return
    await prisma.leaguePlayerWeeklyScore.deleteMany({ where: { leagueId: { in: created.platformLeagueIds } } }).catch(() => {})
    await prisma.weeklyMatchup.deleteMany({ where: { leagueId: { in: created.platformLeagueIds } } }).catch(() => {})
    for (const id of created.leagues) await prisma.league.delete({ where: { id } }).catch(() => {})
    for (const id of created.users) await prisma.appUser.delete({ where: { id } }).catch(() => {})
  })

  // ── league_player_weekly_scores ─────────────────────────────────────────────────────────────
  describe('weekly scores', () => {
    const pl = () => `${STAMP}-lpws-${Math.random().toString(36).slice(2, 8)}`
    const week = (p1: number, starters = ['p1', 'p2']) => [{
      matchup_id: 1, roster_id: 7, points: p1 + 12.4,
      starters, starters_points: starters.map((id) => (id === 'p1' ? p1 : id === 'p2' ? 12.4 : 3.1)),
      players: ['p1', 'p2', 'p3'], players_points: { p1, p2: 12.4, p3: 3.1 },
    }]
    const rows = (leagueId: string) =>
      prisma.leaguePlayerWeeklyScore.findMany({ where: { leagueId }, orderBy: { playerId: 'asc' } })
    const rowXmins = (leagueId: string) =>
      xmins(`SELECT "playerId" AS k, xmin::text AS x FROM league_player_weekly_scores WHERE "leagueId" = $1`, leagueId)

    it('inserts with CUID ids and UTC timestamps; an identical re-sync rewrites nothing', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:12`, week(20.5))
      const before = Date.now()
      expect(await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)).toMatchObject({ scoresUpserted: 3, error: null })
      const first = await rows(L)
      expect(first.map((r) => [r.playerId, r.points, r.rosterId, r.isStarter, r.isFinalized, r.source])).toEqual([
        ['p1', 20.5, 7, true, false, 'sleeper'], ['p2', 12.4, 7, true, false, 'sleeper'], ['p3', 3.1, 7, false, false, 'sleeper'],
      ])
      // The id format is the model's own @default(cuid()) — unchanged from the old writer.
      expect(first.every((r) => CUID.test(r.id))).toBe(true)
      for (const r of first) expect(Math.abs(r.updatedAt.getTime() - before)).toBeLessThan(60_000)

      const x1 = await rowXmins(L)
      expect(await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)).toMatchObject({ scoresUpserted: 0, scoresUnchanged: 3, error: null })
      expect(await rowXmins(L)).toEqual(x1)
    })

    it('a correction rewrites exactly one row, makes it provisional, keeps its id, stamps UTC; sealed rows stay sealed', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:12`, week(20.5))
      await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      await prisma.leaguePlayerWeeklyScore.updateMany({ where: { leagueId: L }, data: { isFinalized: true } })
      const ids = (await rows(L)).map((r) => r.id)
      const x1 = await rowXmins(L)

      // Identical again: still sealed, untouched.
      await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      expect(await rowXmins(L)).toEqual(x1)
      expect((await rows(L)).every((r) => r.isFinalized)).toBe(true)

      provider.matchups.set(`${L}:12`, week(22.5))
      const before = Date.now()
      expect(await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)).toMatchObject({ scoresUpserted: 1, scoresUnchanged: 2 })
      const after = await rows(L)
      expect(after.map((r) => r.id)).toEqual(ids)
      expect(after.map((r) => [r.playerId, r.points, r.isFinalized])).toEqual([
        ['p1', 22.5, false], ['p2', 12.4, true], ['p3', 3.1, true],
      ])
      // timezone('UTC', now()) — correct even when the session zone is not UTC.
      expect(Math.abs(after[0].updatedAt.getTime() - before)).toBeLessThan(60_000)
      const x2 = await rowXmins(L)
      expect(x2.get('p1')).not.toBe(x1.get('p1'))
      expect(x2.get('p2')).toBe(x1.get('p2'))
      expect(x2.get('p3')).toBe(x1.get('p3'))
    })

    it('a starter/bench move is a change', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:12`, week(20.5))
      await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      provider.matchups.set(`${L}:12`, week(20.5, ['p1', 'p3']))
      expect((await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)).scoresUpserted).toBe(2)
      expect((await rows(L)).map((r) => [r.playerId, r.isStarter])).toEqual([['p1', true], ['p2', false], ['p3', true]])
    })

    it('a stale read (another writer got there first) neither duplicates nor unseals', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:12`, week(20.5))
      await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      await prisma.leaguePlayerWeeklyScore.updateMany({ where: { leagueId: L }, data: { isFinalized: true } })
      const x1 = await rowXmins(L)
      // The writer reads an empty week, so it believes every row is new.
      const spy = vi.spyOn(prisma.leaguePlayerWeeklyScore, 'findMany').mockResolvedValueOnce([] as never)
      try {
        const r = await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
        expect(r).toMatchObject({ scoresUpserted: 0, error: null })
      } finally {
        spy.mockRestore()
      }
      expect(await rowXmins(L)).toEqual(x1)
      expect(await prisma.leaguePlayerWeeklyScore.count({ where: { leagueId: L } })).toBe(3)
    })

    it('kill switch: the legacy writer still works against the real schema', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:12`, week(20.5))
      await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      const x1 = await rowXmins(L)
      process.env.AF_CHANGE_AWARE_WRITES_OFF = 'weekly-scores'
      expect((await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)).scoresUpserted).toBe(3)
      const x2 = await rowXmins(L)
      for (const p of ['p1', 'p2', 'p3']) expect(x2.get(p)).not.toBe(x1.get(p)) // rewritten, as before
    })
  })

  // ── concurrency: older sync vs newer live tick, and createMany conflicts ────────────────────
  describe('concurrency', () => {
    const pl = () => `${STAMP}-cc-${Math.random().toString(36).slice(2, 8)}`
    const week = (p1: number, players: Record<string, number> = { p2: 12.4, p3: 3.1 }) => [{
      matchup_id: 1, roster_id: 7, points: p1 + 12.4,
      starters: ['p1', 'p2'], starters_points: [p1, 12.4],
      players: ['p1', ...Object.keys(players)], players_points: { p1, ...players },
    }]
    const byPlayer = async (leagueId: string) =>
      new Map((await prisma.leaguePlayerWeeklyScore.findMany({ where: { leagueId } })).map((r) => [r.playerId, r]))

    it('an OLDER sync finishing after a NEWER live tick does not overwrite the live points (update path)', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:12`, week(20.5))
      await ingestSleeperPlayerScoresForWeek(L, SEASON, 12) // baseline rows

      // The sync (A) starts its provider call; while it is in flight a live tick (B) fetches newer
      // points and writes them. A's response — fetched first — then arrives carrying older points.
      provider.queue.push(async () => {
        provider.matchups.set(`${L}:12`, week(25))
        await new Promise((r) => setTimeout(r, 5))
        const live = await ingestSleeperPlayerScoresForWeek(L, SEASON, 12) // B, observed after A
        expect(live.scoresUpserted).toBe(1)
        return week(22) // A's older observation
      })
      const sync = await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      expect(sync).toMatchObject({ scoresUpserted: 0, error: null })
      expect((await byPlayer(L)).get('p1')?.points).toBe(25)
    })

    it('a NEWER sync still overwrites an OLDER stored observation (the fence is not a freeze)', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:12`, week(20.5))
      await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      await new Promise((r) => setTimeout(r, 5))
      provider.matchups.set(`${L}:12`, week(22))
      expect((await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)).scoresUpserted).toBe(1)
      expect((await byPlayer(L)).get('p1')?.points).toBe(22)
    })

    it('createMany conflict, ALL rows taken by a newer concurrent writer: none overwritten, no duplicates', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:12`, week(25))
      provider.queue.push(async () => week(22)) // A's (older) observation
      // A reads an empty week; before A inserts, the live tick (B) observes and inserts everything.
      const spy = vi.spyOn(prisma.leaguePlayerWeeklyScore, 'findMany')
      spy.mockImplementationOnce(async (...args: unknown[]) => {
        spy.mockRestore()
        const rows = await (prisma.leaguePlayerWeeklyScore.findMany as any)(...args)
        await new Promise((r) => setTimeout(r, 5))
        await ingestSleeperPlayerScoresForWeek(L, SEASON, 12) // B
        return rows as never
      })
      const a = await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      expect(a).toMatchObject({ scoresUpserted: 0, error: null })
      const rows = await byPlayer(L)
      expect(rows.size).toBe(3)
      expect(rows.get('p1')?.points).toBe(25)
    })

    it('createMany PARTIAL conflict: the inserted rows stay, the conflicting newer row is kept', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.queue.push(async () => week(22)) // A
      const spy = vi.spyOn(prisma.leaguePlayerWeeklyScore, 'findMany')
      spy.mockImplementationOnce(async (...args: unknown[]) => {
        spy.mockRestore()
        const rows = await (prisma.leaguePlayerWeeklyScore.findMany as any)(...args)
        await new Promise((r) => setTimeout(r, 5))
        // B observes later and inserts ONLY p1, with a different value.
        provider.queue.push(async () => [{ matchup_id: 1, roster_id: 7, points: 25, starters: ['p1'], starters_points: [25], players: ['p1'], players_points: { p1: 25 } }])
        await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
        return rows as never
      })
      const a = await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      expect(a.error).toBeNull()
      expect(a.scoresUpserted).toBe(2) // p2, p3 inserted; p1 declined by the fence
      const rows = await byPlayer(L)
      expect(rows.size).toBe(3)
      expect(rows.get('p1')?.points).toBe(25)
      expect(rows.get('p2')?.points).toBe(12.4)
      expect(rows.get('p3')?.points).toBe(3.1)
    })

    it('createMany PARTIAL conflict with an OLDER concurrent row: that row is corrected to our newer value', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.queue.push(async () => week(22)) // A
      const spy = vi.spyOn(prisma.leaguePlayerWeeklyScore, 'findMany')
      spy.mockImplementationOnce(async (...args: unknown[]) => {
        spy.mockRestore()
        const rows = await (prisma.leaguePlayerWeeklyScore.findMany as any)(...args)
        // A row observed an hour ago lands between A's read and A's insert, sealed, with another value.
        await prisma.leaguePlayerWeeklyScore.create({ data: {
          leagueId: L, seasonYear: SEASON, week: 12, playerId: 'p1', rosterId: 7, points: 19, isStarter: true,
          isFinalized: true, source: 'sleeper', updatedAt: new Date(Date.now() - 3_600_000),
        } })
        return rows as never
      })
      const a = await ingestSleeperPlayerScoresForWeek(L, SEASON, 12)
      expect(a).toMatchObject({ scoresUpserted: 3, error: null })
      const rows = await byPlayer(L)
      expect(rows.size).toBe(3)
      expect(rows.get('p1')).toMatchObject({ points: 22, isFinalized: false })
    })

    it('two writers inserting the same empty week at once: one set of rows, no error', async () => {
      const L = pl(); created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:12`, week(20.5))
      const [x, y] = await Promise.all([
        ingestSleeperPlayerScoresForWeek(L, SEASON, 12),
        ingestSleeperPlayerScoresForWeek(L, SEASON, 12),
      ])
      expect(x.error).toBeNull()
      expect(y.error).toBeNull()
      expect(await prisma.leaguePlayerWeeklyScore.count({ where: { leagueId: L } })).toBe(3)
    })

    it('team_performances PARTIAL createMany conflict: every row ends correct', async () => {
      const L = `${STAMP}-tpcc-${Math.random().toString(36).slice(2, 8)}`
      const league = await prisma.league.create({ data: { userId, platform: 'sleeper', platformLeagueId: L, season: SEASON, sport: 'NFL', name: 'cc', leagueSize: 2 } })
      created.leagues.push(league.id)
      const [t1, t2] = await Promise.all(['1', '2'].map((x) => prisma.leagueTeam.create({ data: { leagueId: league.id, externalId: x, ownerName: x, teamName: x } })))
      const spy = vi.spyOn(prisma.teamPerformance, 'findMany')
      spy.mockImplementationOnce(async (...args: unknown[]) => {
        spy.mockRestore()
        const rows = await (prisma.teamPerformance.findMany as any)(...args)
        await prisma.teamPerformance.create({ data: { teamId: t1.id, season: SEASON, week: 1, points: 50, opponent: t2.id, result: 'L' } })
        return rows as never
      })
      const out = await writeTeamPerformances({ season: SEASON, rows: [
        { teamId: t1.id, week: 1, points: 100, opponent: t2.id, result: 'W' },
        { teamId: t2.id, week: 1, points: 90, opponent: t1.id, result: 'L' },
      ] })
      expect(out.fellBack).toBe(false)
      const perf = await prisma.teamPerformance.findMany({ where: { teamId: { in: [t1.id, t2.id] } } })
      expect(perf).toHaveLength(2)
      expect(perf.find((p) => p.teamId === t1.id)).toMatchObject({ points: 100, result: 'W' })
      expect(perf.find((p) => p.teamId === t2.id)).toMatchObject({ points: 90, result: 'L' })
    })
  })

  // ── bootstrap: rosters + team_performances ──────────────────────────────────────────────────
  describe('bootstrap (rosters, team_performances)', () => {
    async function makeLeague() {
      const platformLeagueId = `${STAMP}-boot-${Math.random().toString(36).slice(2, 8)}`
      const normalized = makeSleeperNormalized({ leagueId: platformLeagueId, season: SEASON })
      const league = await prisma.league.create({
        data: {
          userId, platform: 'sleeper', platformLeagueId, season: SEASON, sport: 'NFL',
          name: normalized.league.name, leagueSize: normalized.league.leagueSize, importedAt: new Date(),
        },
      })
      created.leagues.push(league.id)
      return { leagueId: league.id, platformLeagueId, normalized }
    }
    const rosterState = (leagueId: string) =>
      prisma.$queryRawUnsafe<Array<{ id: string; x: string; updatedAt: Date; playerData: any }>>(
        `SELECT id, xmin::text AS x, "updatedAt", "playerData" FROM rosters WHERE "leagueId" = $1 ORDER BY id`, leagueId)
    const tpXmins = (leagueId: string) =>
      xmins(`SELECT tp.id AS k, tp.xmin::text AS x FROM team_performances tp JOIN league_teams lt ON lt.id = tp."teamId" WHERE lt."leagueId" = $1`, leagueId)

    it('an identical re-sync rewrites no roster data and no team performance; roster freshness still advances', async () => {
      const { leagueId, normalized } = await makeLeague()
      await bootstrapLeagueFromNormalizedImport(leagueId, normalized)
      const r1 = await rosterState(leagueId)
      const tp1 = await tpXmins(leagueId)
      expect(r1).toHaveLength(2)
      expect(tp1.size).toBe(2)
      expect([...tp1.keys()].every((id) => UUID.test(id))).toBe(true)

      await new Promise((r) => setTimeout(r, 20))
      const again = { ...normalized, source: { ...normalized.source, imported_at: new Date().toISOString(), import_batch_id: 'batch-2' } }
      await bootstrapLeagueFromNormalizedImport(leagueId, again)
      const r2 = await rosterState(leagueId)
      // playerData byte-identical (the run-scoped imported_at was NOT rewritten)…
      expect(r2.map((r) => JSON.stringify(r.playerData))).toEqual(r1.map((r) => JSON.stringify(r.playerData)))
      // …while updatedAt advanced, so every freshness reader still sees a fresh read.
      for (let i = 0; i < r1.length; i++) expect(r2[i].updatedAt.getTime()).toBeGreaterThan(r1[i].updatedAt.getTime())
      expect(await tpXmins(leagueId)).toEqual(tp1)
    })

    it('a real roster change and a real score change are written', async () => {
      const { leagueId, platformLeagueId } = await makeLeague()
      const base = makeSleeperNormalized({ leagueId: platformLeagueId, season: SEASON })
      await bootstrapLeagueFromNormalizedImport(leagueId, base)
      const tp1 = await tpXmins(leagueId)

      const changed = makeSleeperNormalized({
        leagueId: platformLeagueId, season: SEASON,
        rosters: [
          { teamId: '1', managerId: 'u1', ownerName: 'Alice', teamName: 'Alpha', wins: 2, losses: 1, ties: 0, pointsFor: 300, players: ['p1', 'p2', 'p3', 'p4', 'p9'], starters: ['p1', 'p2'], reserve: [], taxi: [], isCommissioner: true },
          { teamId: '2', managerId: 'u2', ownerName: 'Bob', teamName: 'Bravo', wins: 1, losses: 2, ties: 0, pointsFor: 250, players: ['p5', 'p6', 'p7'], starters: ['p5'], reserve: [], taxi: [] },
        ],
      })
      changed.schedule = changed.schedule.map((w) => ({ ...w, matchups: w.matchups.map((m) => ({ ...m, points_1: 101.5 })) }))
      await bootstrapLeagueFromNormalizedImport(leagueId, changed)

      const teams = await prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, externalId: true } })
      const rosters = await prisma.roster.findMany({ where: { leagueId } })
      const alpha = rosters.find((r) => (r.playerData as any).source_team_id === '1')!
      expect((alpha.playerData as any).players).toEqual(['p1', 'p2', 'p3', 'p4', 'p9'])

      const perf = await prisma.teamPerformance.findMany({ where: { teamId: { in: teams.map((t) => t.id) } } })
      const t1 = teams.find((t) => t.externalId === '1')!.id
      const t2 = teams.find((t) => t.externalId === '2')!.id
      expect(perf.find((p) => p.teamId === t1)).toMatchObject({ points: 101.5, opponent: t2, result: 'W' })
      const tp2 = await tpXmins(leagueId)
      const changedIds = [...tp2.keys()].filter((id) => tp2.get(id) !== tp1.get(id))
      expect(changedIds).toEqual([perf.find((p) => p.teamId === t1)!.id])
    })

    it('kill switch "all": the old always-write behaviour works against the real schema', async () => {
      const { leagueId, normalized } = await makeLeague()
      await bootstrapLeagueFromNormalizedImport(leagueId, normalized)
      const tp1 = await tpXmins(leagueId)
      process.env.AF_CHANGE_AWARE_WRITES_OFF = 'all'
      await bootstrapLeagueFromNormalizedImport(leagueId, normalized)
      const tp2 = await tpXmins(leagueId)
      for (const [id, x] of tp1) expect(tp2.get(id)).not.toBe(x)
    })
  })

  // ── WeeklyMatchup cache ─────────────────────────────────────────────────────────────────────
  describe('matchup cache', () => {
    it('an unchanged week keeps its rows (no delete/insert) and advances updatedAt; a change replaces it', async () => {
      const L = `${STAMP}-wm`; created.platformLeagueIds.push(L)
      provider.matchups.set(`${L}:1`, [
        { roster_id: 1, matchup_id: 1, points: 30 },
        { roster_id: 2, matchup_id: 1, points: 20 },
      ])
      await ensureMatchupsCached(L, 1, SEASON)
      const first = await prisma.weeklyMatchup.findMany({ where: { leagueId: L }, orderBy: { rosterId: 'asc' } })
      expect(first.map((r) => [r.rosterId, r.pointsFor, r.pointsAgainst, r.win])).toEqual([['1', 30, 20, 1], ['2', 20, 30, 0]])

      await new Promise((r) => setTimeout(r, 20))
      await ensureMatchupsCached(L, 1, SEASON, 0) // threshold 0: always refetch
      const second = await prisma.weeklyMatchup.findMany({ where: { leagueId: L }, orderBy: { rosterId: 'asc' } })
      expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id)) // not deleted and reinserted
      for (let i = 0; i < 2; i++) expect(second[i].updatedAt.getTime()).toBeGreaterThan(first[i].updatedAt.getTime())

      provider.matchups.set(`${L}:1`, [
        { roster_id: 1, matchup_id: 1, points: 31 },
        { roster_id: 2, matchup_id: 1, points: 20 },
      ])
      await ensureMatchupsCached(L, 1, SEASON, 0)
      const third = await prisma.weeklyMatchup.findMany({ where: { leagueId: L }, orderBy: { rosterId: 'asc' } })
      expect(third.map((r) => r.pointsFor)).toEqual([31, 20])
      expect(third.map((r) => r.id)).not.toEqual(first.map((r) => r.id)) // replaced, as before
    })
  })
})
