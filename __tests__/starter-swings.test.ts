/**
 * A live league-week's standing — what the per-slate digest (lib/live/slateDigest.ts) reads.
 *
 * The per-swing alerts these tests used to cover were removed 2026-10-11 (owner's decision; see
 * slateDigest.ts for the measurement). What remains is the state they were built on.
 *
 * ⚠ THE LOADER TESTS GO THROUGH THE REAL SCORING PATH. Projections are priced by
 * `computeLeagueProjectedPoints` under a real `scoring_settings` object, not injected as numbers,
 * so a wiring break between the projection feed and the model fails here instead of shipping a
 * digest that never has a win probability to show.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  scoreFind: vi.fn(),
  matchupFind: vi.fn(),
  projectionFind: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leaguePlayerWeeklyScore: { findMany: h.scoreFind },
    weeklyMatchup: { findMany: h.matchupFind },
    fantasyProjection: { findMany: h.projectionFind },
  },
}))

import { buildLeagueWeekState, loadLeagueWeekState, type ScoreRow } from '@/lib/live/starterSwings'

const row = (rosterId: number, playerId: string, points: number, isStarter = true): ScoreRow => ({
  rosterId,
  playerId,
  points,
  isStarter,
})

const H2H = [
  { rosterId: '1', matchupId: 1 },
  { rosterId: '2', matchupId: 1 },
]
const TEN = new Map([['a1', 10], ['a2', 10], ['b1', 10], ['b2', 10]])
const state = (rows: ScoreRow[], projections = TEN, pairing = H2H) =>
  buildLeagueWeekState({ rows, pairing, projectionByPlayer: projections })

describe('buildLeagueWeekState', () => {
  it('totals starters only — a benched player scores nothing for you', () => {
    const s = state([row(1, 'a1', 12), row(1, 'bench', 30, false), row(2, 'b1', 5)])
    expect(s.rosters.get('1')!.total).toBe(12)
    expect(s.rosters.get('1')!.opponentRosterId).toBe('2')
  })

  it('a team ahead on points has the better win chance', () => {
    const s = state([row(1, 'a1', 25), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)])
    expect(s.rosters.get('1')!.pWin!).toBeGreaterThan(0.5)
    expect(s.rosters.get('2')!.pWin!).toBeLessThan(0.5)
  })

  it('says nothing about odds when a starter cannot be priced — never treats unknown as zero', () => {
    const s = state([row(1, 'a1', 25), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)], new Map([['a1', 10]]))
    expect(s.rosters.get('1')!.pWin).toBeNull()
    expect(s.rosters.get('1')!.projectedFinish).toBeNull()
  })

  it('ranks an elimination field on projected finish, and refuses to with an unpriced starter', () => {
    const FIELD = [
      { rosterId: '1', matchupId: 1 },
      { rosterId: '2', matchupId: 2 },
      { rosterId: '3', matchupId: 3 },
    ]
    const rows = [row(1, 'a1', 14), row(2, 'b1', 12), row(3, 'c1', 3)]
    const priced = buildLeagueWeekState({ rows, pairing: FIELD, projectionByPlayer: new Map([['a1', 10], ['b1', 10], ['c1', 10]]) })
    expect([...priced.lowestProjected!]).toEqual(['3'])
    const unpriced = buildLeagueWeekState({ rows, pairing: FIELD, projectionByPlayer: new Map([['a1', 10], ['b1', 10]]) })
    expect(unpriced.lowestProjected).toBeNull()
  })
})

describe('loadLeagueWeekState', () => {
  /* Real scoring path: 0.1 per rushing yard, 100 projected yards = 10 points. */
  const SETTINGS = { scoring_settings: { rush_yd: 0.1 } }
  const projectionRow = (playerId: string) => ({ playerId, stats: { stats: { rush_yd: 100 } } })

  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset()
    h.scoreFind.mockResolvedValue([row(1, 'a1', 25), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)])
    h.matchupFind.mockResolvedValue(H2H)
    h.projectionFind.mockResolvedValue(['a1', 'a2', 'b1', 'b2'].map(projectionRow))
  })

  const load = () => loadLeagueWeekState({ platformLeagueId: 'SL1', season: 2026, week: 2, settings: SETTINGS })

  it('prices the starters through the league’s own scoring and reaches a win probability', async () => {
    const s = await load()
    expect(s!.rosters.get('1')!.total).toBe(25)
    expect(s!.rosters.get('1')!.pWin!).toBeGreaterThan(0.9)
  })

  it('asks the projection feed for this league-week, never the AF mirror rows', async () => {
    await load()
    const where = h.projectionFind.mock.calls[0]![0].where
    expect(where).toMatchObject({ season: '2026', week: 2, source: { not: 'allfantasy' } })
  })

  it('is null without a schedule to pair the rosters', async () => {
    h.matchupFind.mockResolvedValue([])
    expect(await load()).toBeNull()
  })
})
