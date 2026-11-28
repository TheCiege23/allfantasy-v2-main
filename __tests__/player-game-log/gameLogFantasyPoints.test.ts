/**
 * Per-game fantasy points in the game log (lib/player-game-log/loadPlayerGameLog.ts), on the real path:
 *
 *   fixtures/live.NHL.json -> normalizeRiGameBox -> normalizedStatMapFor   (what player_game_stats holds)
 *     -> the loader -> getDailySportNormalizer -> buildLeagueStatScorer     (what the matchup engine runs)
 *
 * The expected value is computed through the weekly scorer's OWN entry point (`aggregateWeeklyStats`
 * over one game), so a game in the log and that game's share of a matchup cannot drift apart.
 * Only the database is faked.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: {
      groupBy: vi.fn(async () => [{ season: 2025 }]),
      findMany: vi.fn(async () => db.rows),
    },
    sportsGame: { findMany: vi.fn(async () => []) },
    league: { findFirst: vi.fn(async () => null) },
  },
}))

import { loadPlayerGameLog } from '@/lib/player-game-log/loadPlayerGameLog'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { aggregateWeeklyStats, normalizeNhlGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { normalizeRiGameBox, normalizedStatMapFor } from '@/lib/sports-data/rollingInsightsGameLogs'

type Line = { group: string; raw: Record<string, unknown>; stored: Record<string, unknown>; gameId: string; team: string | null; opponent: string | null }

function fixtureLines(): Line[] {
  const games = (JSON.parse(readFileSync(join(process.cwd(), 'contracts/rolling-insights/fixtures/live.NHL.json'), 'utf8')) as {
    data: { NHL: unknown[] }
  }).data.NHL
  const out: Line[] = []
  for (const game of games) {
    const box = normalizeRiGameBox(game)!
    for (const line of box.lines) {
      const l = line as unknown as { group: string; raw: Record<string, unknown>; team?: string | null; opponent?: string | null }
      out.push({
        group: l.group,
        raw: l.raw,
        stored: normalizedStatMapFor(line, box) as Record<string, unknown>,
        gameId: String((box as unknown as { gameId?: string }).gameId ?? 'g'),
        team: l.team ?? null,
        opponent: l.opponent ?? null,
      })
    }
  }
  return out
}

const LINES = fixtureLines()
const scorer = (settings: unknown) => buildLeagueStatScorer({ sport: 'NHL', settings })!

function storeRow(l: Line, i: number) {
  return {
    gameId: `${l.gameId}-${i}:${l.group}`,
    providerGameId: `${l.gameId}-${i}`,
    gameDate: new Date(Date.UTC(2026, 0, 1 + i)),
    team: l.team,
    opponent: l.opponent,
    season: 2025,
    statPayload: l.raw,
    normalizedStatMap: { ...l.stored, seasonType: 'regular' },
  }
}

/** One game, scored exactly the way the weekly sync scores a week. */
const expected = (l: Line, s: ReturnType<typeof scorer>) => s(aggregateWeeklyStats([l.stored], normalizeNhlGameStats).stats, null)

const scorers = LINES.filter((l) => l.group === 'skaters' && Number(l.raw.goals) > 0)
const goalie = LINES.find((l) => l.group === 'goalies' && Number(l.raw.saves) > 0)

beforeEach(() => {
  db.rows = []
})

describe('game log fantasy points', () => {
  it('the fixture has the lines this test needs (control)', () => {
    expect(scorers.length).toBeGreaterThan(1)
    expect(goalie).toBeTruthy()
  })

  it('scores every game on the sport defaults exactly as the matchup engine does', async () => {
    const lines = [...scorers.slice(0, 3), goalie!]
    db.rows = lines.map(storeRow)
    const s = scorer(null)
    const log = await loadPlayerGameLog({ identityId: 'p1', sport: 'NHL', scorer: s })
    const rows = log.groups.flatMap((g) => g.rows)
    expect(rows).toHaveLength(lines.length)
    for (const [i, l] of lines.entries()) {
      const row = rows.find((r) => r.gameId === `${l.gameId}-${i}:${l.group}`)!
      expect(row.fantasyPoints).toBeCloseTo(expected(l, s), 2)
    }
    // A goal is worth something on the defaults, so a scorer's game is not 0.
    expect(rows.find((r) => r.gameId.endsWith(':skaters'))!.fantasyPoints).toBeGreaterThan(0)
  })

  it("uses the league's own weights: tripling a goal moves the points by twice the goals", async () => {
    const l = scorers[0]
    db.rows = [storeRow(l, 0)]
    const base = scorer(null)
    const goalsKey = 'g' // the normalized key the NHL defaults score (goals -> g)
    const baseWeight = base({ [goalsKey]: 1 }, null)
    expect(baseWeight).toBeGreaterThan(0) // control: goals score on the defaults
    const league = scorer({ sportConfig: { categoryPoints: { [goalsKey]: baseWeight * 3 } } })
    const a = (await loadPlayerGameLog({ identityId: 'p1', sport: 'NHL', scorer: base })).groups[0].rows[0].fantasyPoints!
    const b = (await loadPlayerGameLog({ identityId: 'p1', sport: 'NHL', scorer: league })).groups[0].rows[0].fantasyPoints!
    expect(b).toBeCloseTo(expected(l, league), 2)
    expect(b - a).toBeCloseTo(2 * baseWeight * Number(l.raw.goals), 2)
  })

  it('a game he did not play has no points, never a 0', async () => {
    // A backup goalie who dressed and never went in: a goalie line with no time on ice and no shots.
    // (A skater line always counts as played — he only has one if he dressed and took a shift.)
    const backup: Line = { ...goalie!, raw: { ...goalie!.raw, time_on_ice: '0:00' }, stored: { ...goalie!.stored, stats: {} } }
    db.rows = [storeRow(backup, 0), storeRow(goalie!, 1)]
    const rows = (await loadPlayerGameLog({ identityId: 'p1', sport: 'NHL', scorer: scorer(null) })).groups[0].rows
    const dnp = rows.find((r) => r.gameId.startsWith(`${goalie!.gameId}-0`))!
    expect(dnp.played).toBe(false)
    expect(dnp.fantasyPoints).toBeNull()
    // Control: the same goalie's real game in the same log does score.
    expect(rows.find((r) => r.gameId.startsWith(`${goalie!.gameId}-1`))!.fantasyPoints).not.toBeNull()
  })

  it('no scorer, no points', async () => {
    db.rows = [storeRow(scorers[0], 0)]
    const row = (await loadPlayerGameLog({ identityId: 'p1', sport: 'NHL' })).groups[0].rows[0]
    expect(row.fantasyPoints).toBeNull()
  })
})
