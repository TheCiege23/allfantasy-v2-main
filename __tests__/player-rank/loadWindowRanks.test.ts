/**
 * Window ranks from the database (lib/player-rank/loadWindowRanks.ts), on the committed NHL capture:
 *
 *   fixtures/live.NHL.json -> normalizeRiGameBox -> normalizedStatMapFor   (what player_game_stats holds)
 *     -> loadWindowRanks / loadPlayerGameLog                                 (the two readers)
 *
 * The check that matters: a player's points in a window equal the SUM of his game-log FPts for the
 * same games. Two screens that disagree about one man's points would be worse than either alone.
 * Only the database is faked.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  cache: new Map<string, unknown>(),
  reads: 0,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: {
      groupBy: vi.fn(async () => [{ season: 2025 }]),
      findMany: vi.fn(async (q: { where: { playerId?: string }; take?: number; cursor?: { id: string } }) => {
        db.reads++
        const rows = q.where.playerId ? db.rows.filter((r) => r.playerId === q.where.playerId) : db.rows
        if (!q.take) return rows
        const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor!.id) + 1 : 0
        return rows.slice(start, start + q.take)
      }),
      findFirst: vi.fn(async () => ({ season: 2025 })),
    },
    playerIdentityMap: { findMany: vi.fn(async () => [...new Set(db.rows.map((r) => r.playerId as string))].map((id) => ({ id, position: id.startsWith('g') ? 'G' : 'C' }))) },
    sportsGame: { findMany: vi.fn(async () => []) },
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => (db.cache.has(where.cacheKey) ? { data: db.cache.get(where.cacheKey) } : null)),
      upsert: vi.fn(async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown } }) => {
        db.cache.set(where.cacheKey, JSON.parse(JSON.stringify(create.data)))
      }),
    },
  },
}))

import { easternToday, loadWindowRanks } from '@/lib/player-rank/loadWindowRanks'
import { addDays, playerWindowRanks } from '@/lib/player-rank/windowRanks'
import { loadPlayerGameLog } from '@/lib/player-game-log/loadPlayerGameLog'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { normalizeRiGameBox, normalizedStatMapFor } from '@/lib/sports-data/rollingInsightsGameLogs'

const NOW = new Date('2026-11-28T17:00:00Z')
const today = easternToday(NOW)
const scorer = buildLeagueStatScorer({ sport: 'NHL', settings: null })!

const lines = (() => {
  const games = (JSON.parse(readFileSync(join(process.cwd(), 'contracts/rolling-insights/fixtures/live.NHL.json'), 'utf8')) as {
    data: { NHL: unknown[] }
  }).data.NHL
  const out: Array<{ group: string; raw: Record<string, unknown>; stored: Record<string, unknown> }> = []
  for (const game of games) {
    const box = normalizeRiGameBox(game)!
    for (const line of box.lines) out.push({ group: line.group, raw: line.raw as Record<string, unknown>, stored: normalizedStatMapFor(line, box) as Record<string, unknown> })
  }
  return out
})()
const skaters = lines.filter((l) => l.group === 'skaters' && Number(l.raw.goals) + Number(l.raw.assists) > 0).slice(0, 6)

/** Player p{k} plays fixture skater lines on the given days ago (each a different game). */
function seed(plan: Record<string, number[]>) {
  db.rows = []
  let n = 0
  for (const [pid, daysAgo] of Object.entries(plan)) {
    daysAgo.forEach((ago, i) => {
      const l = skaters[(n + i) % skaters.length]
      db.rows.push({
        id: `row-${String(db.rows.length).padStart(4, '0')}`,
        playerId: pid,
        gameId: `g-${pid}-${i}:skaters`,
        providerGameId: `g-${pid}-${i}`,
        gameDate: new Date(`${addDays(today, -ago)}T00:00:00Z`),
        team: null,
        opponent: null,
        season: 2025,
        statPayload: l.raw,
        normalizedStatMap: { ...l.stored, seasonType: 'regular' },
      })
    })
    n += 2
  }
}

beforeEach(() => {
  db.cache.clear()
  db.reads = 0
})

describe('loadWindowRanks', () => {
  it("a player's window points equal the sum of his game-log FPts over the same games", async () => {
    seed({ p1: [1, 3, 10, 40], p2: [2, 20], p3: [5] })
    const table = (await loadWindowRanks({ sport: 'NHL', season: 2025, scoringKey: 'default', scorer, now: NOW }))!
    const log = await loadPlayerGameLog({ identityId: 'p1', sport: 'NHL', scorer })
    const rows = log.groups.flatMap((g) => g.rows)
    const sumDays = (maxAgo: number | null) =>
      rows
        .filter((r) => r.date! < today && (maxAgo == null || r.date! >= addDays(today, -maxAgo)))
        .reduce((s, r) => s + (r.fantasyPoints ?? 0), 0)
    const p1 = playerWindowRanks(table, 'p1').windows
    expect(sumDays(7)).toBeGreaterThan(0) // control: the fixture lines score
    expect(p1[0].points).toBeCloseTo(sumDays(7), 1)
    expect(p1[0].games).toBe(2)
    expect(p1[2].points).toBeCloseTo(sumDays(30), 1)
    expect(p1[3]).toMatchObject({ games: 4 })
    expect(p1[3].points).toBeCloseTo(sumDays(null), 1)
    expect(table.windows.d7.population).toBe(3)
    expect(table.windows.d30.population).toBe(3)
  })

  it('reads the database once per day and scoring; the second card comes from the cache', async () => {
    seed({ p1: [1], p2: [2] })
    await loadWindowRanks({ sport: 'NHL', season: 2025, scoringKey: 'default', scorer, now: NOW })
    const after = db.reads
    expect(after).toBeGreaterThan(0)
    await loadWindowRanks({ sport: 'NHL', season: 2025, scoringKey: 'default', scorer, now: NOW })
    expect(db.reads).toBe(after)
    // A different league's scoring is a different table.
    await loadWindowRanks({ sport: 'NHL', season: 2025, scoringKey: 'lg-1', scorer, now: NOW })
    expect(db.reads).toBeGreaterThan(after)
  })

  it('pages through a season larger than one read', async () => {
    seed(Object.fromEntries(Array.from({ length: 2600 }, (_, i) => [`p${i}`, [1, 2]])))
    const table = (await loadWindowRanks({ sport: 'NHL', season: 2025, scoringKey: 'default', scorer, now: NOW }))!
    expect(db.rows.length).toBe(5200) // more than one page of 5000
    expect(table.windows.d7.population).toBe(2600)
  })
})
