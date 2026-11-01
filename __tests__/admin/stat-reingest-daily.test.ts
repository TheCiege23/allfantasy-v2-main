import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The admin stat re-ingest PREVIEW for DAILY-LINEUP leagues (lib/admin/statReingest.ts →
 * `previewDailyWeekRescore`): the week's per-day lines are rebuilt in memory and scored by the matchup
 * engine's own daily scorer (`scoreRosterStartersDaily` with `inject`), with no database write.
 *
 * One in-memory store backs BOTH the shared `@/lib/prisma` client and the `deps.prisma` the preview is
 * handed, and every write method on it throws — so any write on the preview path fails the suite.
 */
const h = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  calls: [] as string[],
  kickoffs: null as null | { byTeamDay: Map<string, Map<string, Date>> },
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.store }))
vi.mock('@/lib/redraft/lineupLock', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/redraft/lineupLock')
  return { ...actual, buildWeekKickoffMap: async () => h.kickoffs ?? { byTeamDay: new Map() } }
})
vi.mock('@/lib/redraft/rosterGameLogIdBridge', () => ({
  bridgeRosterIdsToGameLogIds: async (_db: unknown, _keys: string[], ids: string[]) => ({
    gameLogIds: ids,
    rosterIdFor: (id: string) => (ids.includes(id) ? id : null),
    bridged: 0,
    nameRefused: [],
    ambiguous: [],
  }),
}))

import { runStatReingest, type StatReingestDeps, type StatReingestRequest } from '@/lib/admin/statReingest'
import { dayKey, type PlayerDailyStats } from '@/lib/redraft/dailyLineups'
import { lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { addDatedGameRow, buildPlayerDailyStatLines } from '@/lib/redraft/playerDailyStatLines'
import { scoreRosterStartersDaily } from '@/lib/redraft/scoringEngine'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { loadDailyWeekDayStats, loadDailyWeekStats } from '@/lib/stat-corrections/dailyWeekStats'

const LEAGUE = 'd41382f9-6700-475d-ac8c-041632dd0a33'
const DAILY = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
// NHL 2026 week 1 is 2026-09-29 .. 2026-10-05 (Eastern days). The NHL default scores 3 per goal (`g`).
const D = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']
const day = (i: number) => new Date(`${D[i]}T00:00:00Z`)
const PTS_PER_GOAL = 3

type Lines = Record<string, Record<string, Record<string, number>>> // playerId → dayKey → stats
const toDaily = (lines: Lines): PlayerDailyStats =>
  new Map(Object.entries(lines).map(([id, days]) => [id, new Map(Object.entries(days).map(([k, stats]) => [k, { stats, isFinalized: false }]))]))

/**
 * One matchup, r1 (home) v r2 (away). Stored 10–8, home wins.
 *   r1 p1  C   daily rows: day0 C, day1 BN → only day0 counts (benched day1 contributes nothing).
 *   r1 p2  W   NO daily rows at all → falls back to his weekly slot (W) every day — the weeks-1–2 case.
 *   r2 p3  C   ADDED day2 → day0's game never counts.
 *   r2 p4  D   DROPPED day1 evening → day0 and day1 count, day3 does not.
 */
const ROSTER = [
  { rosterId: 'r1', playerId: 'p1', playerName: 'P One', position: 'C', slotType: 'C', sport: 'NHL', team: 'BOS', addedAt: null, droppedAt: null },
  { rosterId: 'r1', playerId: 'p2', playerName: 'P Two', position: 'W', slotType: 'W', sport: 'NHL', team: 'BOS', addedAt: null, droppedAt: null },
  { rosterId: 'r2', playerId: 'p3', playerName: 'P Three', position: 'C', slotType: 'C', sport: 'NHL', team: 'TOR', addedAt: new Date('2026-10-01T16:00:00Z'), droppedAt: null },
  { rosterId: 'r2', playerId: 'p4', playerName: 'P Four', position: 'D', slotType: 'D', sport: 'NHL', team: 'TOR', addedAt: null, droppedAt: new Date('2026-09-30T23:00:00Z') },
]
const FRESH: Lines = {
  p1: { [D[0]]: { g: 1 }, [D[1]]: { g: 2 } },
  p2: { [D[0]]: { g: 1 }, [D[2]]: { g: 1 } },
  p3: { [D[0]]: { g: 3 }, [D[2]]: { g: 2 } },
  p4: { [D[0]]: { g: 1 }, [D[1]]: { g: 1 }, [D[3]]: { g: 5 } },
}
const STORED: Lines = {
  p1: { [D[0]]: { g: 0 }, [D[1]]: { g: 2 } },
  p3: { [D[2]]: { g: 1 } },
  p4: { [D[0]]: { g: 1 }, [D[1]]: { g: 1 } },
}

function inWindow(d: Date, w: { gte?: Date; lt?: Date } | undefined) {
  return (!w?.gte || d >= w.gte) && (!w?.lt || d < w.lt)
}
const idsIn = (v: unknown, id: string) =>
  v == null ? true : typeof v === 'string' ? v === id : ((v as { in: string[] }).in ?? []).includes(id)

/** Reads only. Every create/update/upsert/delete — and any table the fixture does not define — throws. */
function readOnly(tables: Record<string, Record<string, (...a: any[]) => unknown>>) {
  const root: Record<string, unknown> = {}
  for (const [name, methods] of Object.entries(tables)) {
    root[name] = new Proxy(methods, {
      get(target, prop: string) {
        if (/^(create|update|upsert|delete)/.test(prop)) {
          return () => {
            throw new Error(`WRITE on preview path: ${name}.${prop}`)
          }
        }
        const fn = target[prop]
        if (!fn) throw new Error(`fixture has no ${name}.${prop}`)
        return (...args: unknown[]) => {
          h.calls.push(`${name}.${prop}`)
          return fn(...args)
        }
      },
    })
  }
  return new Proxy(root, {
    get(target, prop: string) {
      if (prop === 'then') return undefined
      if (prop.startsWith('$')) throw new Error(`WRITE-capable ${prop} on preview path`)
      if (!(prop in target)) throw new Error(`fixture has no table ${prop}`)
      return target[prop]
    },
  })
}

function buildStore(opts: { settings?: Record<string, unknown>; storedLines?: Lines; dailyLineupRows?: boolean } = {}) {
  const settings = opts.settings ?? DAILY
  const storedLines = opts.storedLines ?? STORED
  const dailyRows =
    opts.dailyLineupRows === false
      ? []
      : [
          { rosterId: 'r1', playerId: 'p1', scoringDay: day(0), slotType: 'C' },
          { rosterId: 'r1', playerId: 'p1', scoringDay: day(1), slotType: 'BN' },
        ]
  return readOnly({
    redraftSeason: {
      findFirst: async () => ({
        id: 'season1',
        leagueId: LEAGUE,
        season: 2026,
        sport: 'NHL',
        status: 'in_season',
        league: { platform: 'allfantasy', sport: 'NHL', settings, bestBallMode: false, leagueVariant: null, leagueType: 'redraft' },
      }),
    },
    league: { findFirst: async () => ({ sport: 'NHL', settings }) },
    redraftMatchup: {
      findMany: async () => [{ id: 'm1', status: 'final', homeRosterId: 'r1', awayRosterId: 'r2', homeScore: 10, awayScore: 8 }],
    },
    redraftRosterPlayer: { findMany: async ({ where }: any) => ROSTER.filter((p) => idsIn(where?.rosterId, p.rosterId)).map((p) => ({ ...p })) },
    redraftDailyLineup: { findMany: async ({ where }: any) => dailyRows.filter((r) => idsIn(where?.rosterId, r.rosterId)) },
    roster: { findMany: async () => [] },
    afRosterLineupAssignment: { findMany: async () => [] },
    playerDailyScore: {
      findMany: async ({ where }: any) =>
        Object.entries(storedLines).flatMap(([playerId, days]) =>
          idsIn(where?.playerId, playerId)
            ? Object.entries(days)
                .map(([k, stats]) => ({ playerId, scoringDay: new Date(`${k}T00:00:00Z`), stats, isFinalized: true }))
                .filter((r) => inWindow(r.scoringDay, where?.scoringDay))
            : [],
        ),
    },
    // Every starter but p2 has a weekly row: p2's week was never synced as a daily player.
    playerWeeklyScore: {
      findUnique: async ({ where }: any) => (where.playerId_week_season_sport.playerId === 'p2' ? null : { isFinalized: true }),
      findMany: async () => [],
    },
    playerGameStat: { findMany: async () => [] },
    leagueAuditLog: { create: async () => ({}) },
  })
}

function deps(extra: Partial<StatReingestDeps> = {}): StatReingestDeps {
  return {
    prisma: h.store as never,
    loadWeekDayStats: vi.fn(async () => toDaily(FRESH)),
    loadWeekStats: vi.fn(async () => {
      throw new Error('the weekly path must not run for a daily league')
    }),
    usesDevyEngine: async () => false,
    usesC2CEngine: async () => false,
    syncWeek: vi.fn(),
    recalcWeek: vi.fn(),
    standings: vi.fn(),
    finalizeWeek: vi.fn(),
    ...extra,
  }
}

const req = (over: Partial<StatReingestRequest> = {}): StatReingestRequest => ({
  sport: 'NHL',
  from: '2026-09-29',
  to: '2026-10-12',
  leagueId: LEAGUE,
  weeks: [1],
  dryRun: true,
  confirm: null,
  skipIngest: false,
  ...over,
})

function useStore(store: Record<string, unknown>) {
  for (const k of Object.keys(h.store)) delete h.store[k]
  // Copy the proxied tables onto the shared object the `@/lib/prisma` mock exported.
  for (const name of [
    'redraftSeason', 'league', 'redraftMatchup', 'redraftRosterPlayer', 'redraftDailyLineup', 'roster',
    'afRosterLineupAssignment', 'playerDailyScore', 'playerWeeklyScore', 'playerGameStat', 'leagueAuditLog',
  ]) {
    h.store[name] = store[name]
  }
}

beforeEach(() => {
  h.calls.length = 0
  h.kickoffs = null
  useStore(buildStore())
})

describe('daily-lineup preview', () => {
  it('reports a real before→after, scored day by day, and writes nothing', async () => {
    const d = deps()
    const out = await runStatReingest(req(), 'admin:x', d)
    const week = out.rescore!.weeks[0]
    expect(week.supported).toBe(true)
    expect(week.reason).toBeUndefined()
    // r1: p1 day0 only (1 goal; day1 benched) + p2 days 0 and 2 on the weekly-slot fallback = 3 goals.
    // r2: p3 day2 only (2 goals; added day2) + p4 days 0 and 1 (dropped day1) = 4 goals.
    const m1 = week.matchups[0]
    expect(m1).toMatchObject({
      matchupId: 'm1',
      home: { rosterId: 'r1', before: 10, after: 3 * PTS_PER_GOAL },
      away: { rosterId: 'r2', before: 8, after: 4 * PTS_PER_GOAL },
      resultFlipped: true,
    })
    expect(week.flips).toBe(1)
    expect(out.rescore!.flips).toBe(1)
    expect(week.startersConsidered).toBe(4)
    expect(week.unchecked).toBe(0)
    // Per-player: stored daily lines vs fresh ones on the same started days. p2 has no stored line.
    expect(week.changes).toEqual([
      { rosterId: 'r1', playerId: 'p1', playerName: 'P One', position: 'C', before: 0, after: 3, delta: 3 },
      { rosterId: 'r2', playerId: 'p3', playerName: 'P Three', position: 'C', before: 3, after: 6, delta: 3 },
    ])
    expect(week.daily).toEqual({ startersWithoutStoredDailyLines: 1, playersWithFreshDailyLines: 4 })
    // Read-only: dry run, no write tool called, and only find* reads reached the store.
    expect(out.rescore!.writeRefusal).toBe('dry_run')
    expect(d.syncWeek).not.toHaveBeenCalled()
    expect(d.recalcWeek).not.toHaveBeenCalled()
    expect(h.calls.length).toBeGreaterThan(0)
    expect(h.calls.every((c) => /\.find(First|Many|Unique)$/.test(c))).toBe(true)
    expect(d.loadWeekDayStats).toHaveBeenCalledWith(expect.objectContaining({ sport: 'NHL', season: 2026, week: 1 }))
  })

  it('the confirmed-write guard still holds: a flip needs allow-flips', async () => {
    const d = deps()
    const out = await runStatReingest(req({ dryRun: false, confirm: true, skipIngest: true }), 'admin:x', d)
    expect(out.rescore!.writeRefusal).toBe('flips_require_allow_flips')
    expect(d.syncWeek).not.toHaveBeenCalled()
  })

  it("an add day belongs to the adding team only when he was added before his game's lock", async () => {
    // p3's team (TOR) locked day2 at 15:00Z; he was added at 16:00Z, so day2 is not r2's.
    const [key] = lockTeamLookupKeys('NHL', 'TOR')
    h.kickoffs = { byTeamDay: new Map([[key, new Map([[D[2], new Date('2026-10-01T15:00:00Z')]])]]) }
    const out = await runStatReingest(req(), 'admin:x', deps())
    expect(out.rescore!.weeks[0].matchups[0].away.after).toBe(2 * PTS_PER_GOAL) // p4 only
  })

  it('with no daily lineup saved for the week, every player is scored on his weekly slot', async () => {
    useStore(buildStore({ dailyLineupRows: false }))
    const out = await runStatReingest(req(), 'admin:x', deps())
    // p1 now starts on day1 too (weekly slot C): 1 + 2 goals, plus p2's 2.
    expect(out.rescore!.weeks[0].matchups[0].home.after).toBe(5 * PTS_PER_GOAL)
  })

  it('a commissioner adjustment rides on top, as updateMatchupScores stores it', async () => {
    const settings = {
      ...DAILY,
      commissioner_score_adjustments: [
        { id: 'a1', matchupId: 'm1', rosterId: 'r1', week: 1, points: 1.5, reason: 'goal review', byUserId: 'u1', at: '2026-10-06T00:00:00Z' },
      ],
    }
    useStore(buildStore({ settings }))
    const out = await runStatReingest(req(), 'admin:x', deps())
    expect(out.rescore!.weeks[0].matchups[0].home.after).toBe(3 * PTS_PER_GOAL + 1.5)
    expect(out.rescore!.weeks[0].matchups[0].away.after).toBe(4 * PTS_PER_GOAL)
  })

  it('still refuses a daily league with games limits, and the weekly-only refusals are unchanged', async () => {
    const { readGamesLimits } = await import('@/lib/redraft/gamesLimits')
    const settings = { ...DAILY, games_limits: { goalieMinStarts: 2 } }
    expect(readGamesLimits(settings, 'NHL')).not.toBeNull()
    useStore(buildStore({ settings }))
    const out = await runStatReingest(req(), 'admin:x', deps())
    expect(out.rescore!.weeks[0]).toMatchObject({ supported: false, reason: 'daily_games_limits' })
    useStore(buildStore())
    const devy = await runStatReingest(req(), 'admin:x', deps({ usesDevyEngine: async () => true }))
    expect(devy.rescore!.weeks[0]).toMatchObject({ supported: false, reason: 'devy_engine' })
  })
})

describe('scoreRosterStartersDaily with injected stats', () => {
  it('equals the DB-loaded scoring for the same lines', async () => {
    // The store's stored daily lines ARE the fresh ones here, and every starter has a weekly row.
    useStore(buildStore({ storedLines: FRESH }))
    const weekly = h.store.playerWeeklyScore as { findUnique: unknown }
    h.store.playerWeeklyScore = { ...weekly, findUnique: async () => ({ isFinalized: true }) }
    const args = { leagueId: LEAGUE, week: 1, seasonYear: 2026, collectPlayerPoints: true }
    for (const rosterId of ['r1', 'r2']) {
      const fromDb = await scoreRosterStartersDaily({ ...args, rosterId })
      const injected = await scoreRosterStartersDaily({ ...args, rosterId }, { db: h.store as never, dailyStats: toDaily(FRESH) })
      expect(fromDb).not.toBeNull()
      expect(injected).toEqual(fromDb)
      expect(fromDb!.points).toBeGreaterThan(0)
    }
  })

  it('without injection, a starter with no weekly row is missing (production behaviour unchanged)', async () => {
    const r1 = await scoreRosterStartersDaily({ leagueId: LEAGUE, rosterId: 'r1', week: 1, seasonYear: 2026 })
    expect(r1!.missingPlayerIds).toEqual(['p2'])
    // Stored lines only: p1 day0 has 0 goals; p2 is missing.
    expect(r1!.points).toBe(0)
  })
})

describe('the shared per-day builder', () => {
  const nhl = getDailySportNormalizer('NHL')!
  const raw = (goals: number) => ({ group: 'skaters', stats: { goals } })

  it('groups by Eastern game day and sums each day by the weekly normalizer', () => {
    const byDay = new Map()
    addDatedGameRow(byDay, day(0), raw(1))
    addDatedGameRow(byDay, day(0), raw(2))
    addDatedGameRow(byDay, day(2), raw(1))
    addDatedGameRow(byDay, day(3), { group: 'skaters', stats: {} })
    const lines = buildPlayerDailyStatLines(byDay, nhl)
    expect(lines.map((l) => [dayKey(l.day), l.stats.g, l.gamesPlayed])).toEqual([
      [D[0], 3, 2],
      [D[2], 1, 1],
    ])
  })

  it("loadDailyWeekDayStats rebuilds the days from player_game_stats, and they sum to the weekly re-sum", async () => {
    const rows = [
      { playerId: 'p1', normalizedStatMap: raw(1), sportType: 'NHL', season: 2026, gameDate: day(0) },
      { playerId: 'p1', normalizedStatMap: raw(2), sportType: 'NHL', season: 2026, gameDate: day(2) },
      { playerId: 'p2', normalizedStatMap: raw(1), sportType: 'NHL', season: 2026, gameDate: day(1) },
    ]
    h.store.playerGameStat = readOnly({ playerGameStat: { findMany: async () => rows } }).playerGameStat
    const players = [
      { playerId: 'p1', playerName: 'P One' },
      { playerId: 'p2', playerName: 'P Two' },
    ]
    const days = await loadDailyWeekDayStats({ sport: 'NHL', season: 2026, week: 1, players })
    const weekly = await loadDailyWeekStats({ sport: 'NHL', season: 2026, week: 1, players })
    expect([...days.get('p1')!.keys()]).toEqual([D[0], D[2]])
    expect(days.get('p1')!.get(D[2])!.stats.g).toBe(2)
    for (const [id, byDay] of days) {
      const summed = [...byDay.values()].reduce((n, l) => n + (l.stats.g ?? 0), 0)
      expect(summed).toBe(weekly.get(id)!.g)
    }
  })
})
