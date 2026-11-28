/**
 * Last season's fantasy points per game in the NHL draft pool, on the league's own scoring
 * (lib/draft-room/storedDraftSeasonStats.ts). Expected values are written from the NHL default
 * weights directly (G 3, A 2, SOG 0.3, BLK 0.3, HIT 0.2), not from the code under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerSeasonStats: { findMany: vi.fn(async () => db.rows) } } }))

import { loadStoredDraftSeasonStats } from '@/lib/draft-room/storedDraftSeasonStats'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'

const skater = { goals: 30, assists: 40, shots_on_goal: 200, blocks: 41, hits: 112 }

beforeEach(() => {
  db.rows = [{ playerId: 'ri-1', season: '2025', gamesPlayed: 80, stats: skater, position: 'C' }]
})

describe('NHL pool FP/G', () => {
  it('scores the season on the defaults and divides by games played', async () => {
    const out = await loadStoredDraftSeasonStats('NHL', ['ri-1'], 2026, buildLeagueStatScorer({ sport: 'NHL', settings: null }))
    const line = out.get('ri-1')!.seasonStatLine!
    expect(line.gamesPlayed).toBe(80)
    // (30*3 + 40*2 + 200*0.3 + 41*0.3 + 112*0.2) / 80 = 264.7 / 80
    expect(line.seasonFantasyPointsPerGame).toBe(3.31)
  })

  it("follows the league's weights", async () => {
    const league = buildLeagueStatScorer({ sport: 'NHL', settings: { sportConfig: { categoryPoints: { g: 6 } } } })
    const line = (await loadStoredDraftSeasonStats('NHL', ['ri-1'], 2026, league)).get('ri-1')!.seasonStatLine!
    // Goals now 6 each: 90 more points over 80 games.
    expect(line.seasonFantasyPointsPerGame).toBe(Math.round(((264.7 + 90) / 80) * 100) / 100)
  })

  it('no scorer (no league): games played still shows, FP/G does not', async () => {
    const line = (await loadStoredDraftSeasonStats('NHL', ['ri-1'], 2026)).get('ri-1')!.seasonStatLine!
    expect(line.gamesPlayed).toBe(80)
    expect(line.seasonFantasyPointsPerGame).toBeUndefined()
  })
})
