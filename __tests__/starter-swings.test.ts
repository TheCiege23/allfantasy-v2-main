/**
 * Starter swing alerts — the pure detector against the real win-probability model, and
 * the notifier against a mocked database.
 *
 * ⚠ THE NOTIFIER TESTS GO THROUGH THE REAL SCORING PATH. Projections are priced by
 * `computeLeagueProjectedPoints` under a real `scoring_settings` object, not injected as
 * numbers, so a wiring break between the projection feed and the model fails here
 * instead of shipping a detector that never has a win probability to compare.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFind: vi.fn(),
  scoreFind: vi.fn(),
  matchupFind: vi.fn(),
  projectionFind: vi.fn(),
  playerFind: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: h.leagueFind },
    leaguePlayerWeeklyScore: { findMany: h.scoreFind },
    weeklyMatchup: { findMany: h.matchupFind },
    fantasyProjection: { findMany: h.projectionFind },
    sportsPlayer: { findMany: h.playerFind },
  },
}))
vi.mock('@/lib/notification-engine', () => ({ ingestBatch: vi.fn() }))

import {
  buildLeagueWeekState,
  detectStarterSwings,
  notifyStarterSwingsForLeagueWeek,
  type ScoreRow,
} from '@/lib/live/starterSwings'
import type { NotificationEvent } from '@/lib/notification-engine'

const row = (rosterId: number, playerId: string, points: number, isStarter = true): ScoreRow => ({
  rosterId,
  playerId,
  points,
  isStarter,
})

/* Two head-to-head rosters, two starters each, every starter projected at 10. */
const H2H = [
  { rosterId: '1', matchupId: 1 },
  { rosterId: '2', matchupId: 1 },
]
const TEN = new Map([['a1', 10], ['a2', 10], ['b1', 10], ['b2', 10]])
const state = (rows: ScoreRow[], projections = TEN, pairing = H2H) =>
  buildLeagueWeekState({ rows, pairing, projectionByPlayer: projections })
const h2h = (before: ScoreRow[], after: ScoreRow[], projections = TEN) =>
  detectStarterSwings(state(before, projections), state(after, projections), { elimination: false })

describe('buildLeagueWeekState', () => {
  it('totals starters only — a benched player scores nothing for you', () => {
    const s = state([row(1, 'a1', 12), row(1, 'bench', 30, false), row(2, 'b1', 5)])
    expect(s.rosters.get('1')!.total).toBe(12)
    expect(s.rosters.get('1')!.opponentRosterId).toBe('2')
  })
})

describe('head-to-head swings', () => {
  it('alerts when the lead changes hands, naming your starter who did it', () => {
    const before = [row(1, 'a1', 5), row(1, 'a2', 0), row(2, 'b1', 8), row(2, 'b2', 0)]
    const after = [row(1, 'a1', 5), row(1, 'a2', 7), row(2, 'b1', 8), row(2, 'b2', 0)]
    const swing = h2h(before, after).find((s) => s.rosterId === '1')!
    expect(swing.kinds).toContain('took_lead')
    expect(swing.primary).toBe('took_lead')
    expect(swing.mover).toEqual({ playerId: 'a2', rosterId: '1', delta: 7, isYours: true })
  })

  it('tells the other side they lost it, naming THEIR opponent’s starter', () => {
    const before = [row(1, 'a1', 5), row(1, 'a2', 0), row(2, 'b1', 8), row(2, 'b2', 0)]
    const after = [row(1, 'a1', 5), row(1, 'a2', 7), row(2, 'b1', 8), row(2, 'b2', 0)]
    const swing = h2h(before, after).find((s) => s.rosterId === '2')!
    expect(swing.primary).toBe('lost_lead')
    expect(swing.mover).toMatchObject({ playerId: 'a2', isYours: false })
  })

  /* From a tie the first score is not a lead changing hands — or every matchup in the
     league alerts on the first touchdown of the day. */
  it('does not alert on breaking a tie, including 0–0 at kickoff', () => {
    const before = [row(1, 'a1', 0), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)]
    const after = [row(1, 'a1', 6), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)]
    expect(h2h(before, after).filter((s) => s.kinds.includes('took_lead'))).toHaveLength(0)
  })

  it('does not alert on the first refresh of the week, when no rows existed before', () => {
    const after = [row(1, 'a1', 25), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)]
    expect(h2h([], after)).toEqual([])
  })

  /*
   * Measured against the real model: a 25-point game from a starter projected for 10
   * moves this matchup from 50% to ~95%; a 12-point game only to ~59%.
   */
  it('alerts on a 15+ point move in win probability, and not on a smaller one', () => {
    const before = [row(1, 'a1', 0), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)]
    const big = h2h(before, [row(1, 'a1', 25), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)])
      .find((s) => s.rosterId === '1')!
    expect(big.kinds).toContain('odds_up')
    expect(big.pWin!.after - big.pWin!.before).toBeGreaterThanOrEqual(0.15)

    const small = h2h(before, [row(1, 'a1', 12), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)])
    expect(small.filter((s) => s.kinds.includes('odds_up'))).toHaveLength(0)
  })

  it('says nothing about odds when a starter cannot be priced — never treats unknown as zero', () => {
    const unpriced = new Map([['a1', 10], ['b1', 10], ['b2', 10]])
    const before = [row(1, 'a1', 0), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)]
    const after = [row(1, 'a1', 25), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)]
    const swings = h2h(before, after, unpriced)
    expect(swings.flatMap((s) => s.kinds).filter((k) => k.startsWith('odds'))).toEqual([])
  })
})

describe('guillotine swings', () => {
  const FIELD = [
    { rosterId: '1', matchupId: 1 },
    { rosterId: '2', matchupId: 2 },
    { rosterId: '3', matchupId: 3 },
  ]
  const P = new Map([['a1', 10], ['b1', 10], ['c1', 10]])
  const elim = (before: ScoreRow[], after: ScoreRow[], projections = P) =>
    detectStarterSwings(
      buildLeagueWeekState({ rows: before, pairing: FIELD, projectionByPlayer: projections }),
      buildLeagueWeekState({ rows: after, pairing: FIELD, projectionByPlayer: projections }),
      { elimination: true },
    )

  it('alerts the team that falls to projected last, naming who climbed past them', () => {
    const before = [row(1, 'a1', 14), row(2, 'b1', 12), row(3, 'c1', 3)]
    const after = [row(1, 'a1', 14), row(2, 'b1', 12), row(3, 'c1', 18)]
    const swings = elim(before, after)
    const fell = swings.find((s) => s.rosterId === '2')!
    expect(fell.primary).toBe('fell_to_cut')
    expect(fell.mover).toMatchObject({ playerId: 'c1', rosterId: '3', isYours: false })
    expect(swings.find((s) => s.rosterId === '3')!.primary).toBe('escaped_cut')
    expect(swings.find((s) => s.rosterId === '1')).toBeUndefined()
  })

  /* Ranking on projected finish, not raw points: on raw points every team is "last" at
     kickoff. And a league with an unpriced starter cannot be ranked honestly at all. */
  it('does not rank a field with an unpriced starter', () => {
    const before = [row(1, 'a1', 14), row(2, 'b1', 12), row(3, 'c1', 3)]
    const after = [row(1, 'a1', 14), row(2, 'b1', 12), row(3, 'c1', 18)]
    expect(elim(before, after, new Map([['a1', 10], ['b1', 10]]))).toEqual([])
  })

  it('never sends head-to-head alerts in an elimination league', () => {
    const before = [row(1, 'a1', 14), row(2, 'b1', 12), row(3, 'c1', 3)]
    const after = [row(1, 'a1', 14), row(2, 'b1', 12), row(3, 'c1', 18)]
    expect(elim(before, after).flatMap((s) => s.kinds).some((k) => k.includes('lead') || k.startsWith('odds'))).toBe(false)
  })
})

describe('notifyStarterSwingsForLeagueWeek', () => {
  /* Real scoring path: 0.1 per rushing yard, 100 projected yards = 10 points. */
  const SETTINGS = { scoring_settings: { rush_yd: 0.1 } }
  const projectionRow = (playerId: string) => ({ playerId, stats: { stats: { rush_yd: 100 } } })
  const before = [row(1, 'a1', 0), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)]
  const after = [row(1, 'a1', 25), row(1, 'a2', 0), row(2, 'b1', 0), row(2, 'b2', 0)]

  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset()
    h.leagueFind.mockResolvedValue([
      {
        id: 'league-uuid-1',
        name: 'Dynasty Gridiron',
        settings: SETTINGS,
        leagueType: 'dynasty',
        leagueVariant: null,
        isDynasty: true,
        guillotineMode: false,
        teams: [
          { externalId: '1', claimedByUserId: 'user-you' },
          { externalId: '2', claimedByUserId: null },
        ],
      },
    ])
    h.scoreFind.mockResolvedValue(after)
    h.matchupFind.mockResolvedValue(H2H)
    h.projectionFind.mockResolvedValue(['a1', 'a2', 'b1', 'b2'].map(projectionRow))
    h.playerFind.mockResolvedValue([{ sleeperId: 'a1', name: 'Bijan Robinson' }])
  })

  const run = async () => {
    const ingest = vi.fn(async (_events: NotificationEvent[]) => undefined)
    const sent = await notifyStarterSwingsForLeagueWeek(
      { platformLeagueId: 'SL1', season: 2026, week: 2, beforeRows: before },
      { ingest },
    )
    return { sent, events: (ingest.mock.calls[0]?.[0] ?? []) as NotificationEvent[] }
  }

  it('tells the claimed manager of that roster, and nobody else', async () => {
    const { sent, events } = await run()
    expect(sent).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]!.userIds).toEqual(['user-you'])
  })

  it('reads like a sentence: the starter, the points and the win chance', async () => {
    const { events } = await run()
    expect(events[0]!.title).toBe('Your win chances jumped in Dynasty Gridiron')
    expect(events[0]!.body).toMatch(/^Bijan Robinson \+25\.0 pts\. Now 25\.0–0\.0\. Win chance 50% → 9\d%\.$/)
  })

  it('is push + in-app only, opens that league’s Matchup, and carries a stable key', async () => {
    const first = (await run()).events[0]!
    expect(first.type).toBe('live_score_swing')
    expect(first.skipChannels).toEqual({ email: true, sms: true })
    expect(first.actionHref).toBe('/core/matchup?league=league-uuid-1')
    const again = (await run()).events[0]!
    expect(again.meta!.idempotencyKey).toBe(first.meta!.idempotencyKey)
    expect(String(first.meta!.idempotencyKey)).toMatch(/^swing:SL1:2026:2:1:odds_up:/)
  })

  it('asks the projection feed for this league-week, never the AF mirror rows', async () => {
    await run()
    const where = h.projectionFind.mock.calls[0]![0].where
    expect(where).toMatchObject({ season: '2026', week: 2, source: { not: 'allfantasy' } })
  })

  it('sends nothing without a schedule to pair the rosters', async () => {
    h.matchupFind.mockResolvedValue([])
    const { sent, events } = await run()
    expect(sent).toBe(0)
    expect(events).toEqual([])
  })

  it('never throws when the database fails', async () => {
    h.leagueFind.mockRejectedValue(new Error('db down'))
    await expect(run()).resolves.toMatchObject({ sent: 0 })
  })
})
