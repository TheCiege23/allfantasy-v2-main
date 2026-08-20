/**
 * Sleeper → league_player_weekly_scores.
 *
 * The cases here are the ones that corrupt data silently rather than throw, so
 * none of them would surface in a smoke test:
 *
 *   - Sleeper returns an all-zero placeholder row for every unplayed week
 *   - "0" is its empty-starter-slot marker, not a player id
 *   - a missing point value coerces to 0, which asserts something false
 *
 * Each is claimed by a comment in the writer; each is asserted here so the claim
 * cannot quietly stop being true.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getLeagueMatchups = vi.fn()
const upsert = vi.fn()

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueMatchups: (...a: unknown[]) => getLeagueMatchups(...a),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { leaguePlayerWeeklyScore: { upsert: (...a: unknown[]) => upsert(...a) } },
}))

import { ingestSleeperPlayerScoresForWeek } from '@/lib/sleeper/sync/ingestSleeperPlayerScores'

/** Ids written, in call order. */
const written = () =>
  upsert.mock.calls.map((c) => (c[0] as { create: { playerId: string } }).create.playerId)

const created = (playerId: string) =>
  upsert.mock.calls
    .map((c) => c[0] as { create: Record<string, unknown> })
    .find((a) => a.create.playerId === playerId)?.create

describe('ingestSleeperPlayerScoresForWeek', () => {
  beforeEach(() => {
    getLeagueMatchups.mockReset()
    upsert.mockReset()
    upsert.mockResolvedValue({})
  })

  it('writes each scored player once, with the platform points verbatim', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1,
        roster_id: 7,
        points: 96.2,
        starters: ['p1', 'p2'],
        starters_points: [20.5, 12.4],
        players: ['p1', 'p2', 'p3'],
        players_points: { p1: 20.5, p2: 12.4, p3: 3.1 },
      },
    ])

    const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)

    expect(r.scoresUpserted).toBe(3)
    expect(written().sort()).toEqual(['p1', 'p2', 'p3'])
    // Points are stored exactly as Sleeper reported them — never recomputed.
    expect(created('p1')?.points).toBe(20.5)
    expect(created('p3')?.points).toBe(3.1)
    expect(created('p1')?.rosterId).toBe(7)
  })

  it('marks only the players in `starters` as starters', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 30,
        starters: ['p1'], starters_points: [20.5],
        players: ['p1', 'p3'], players_points: { p1: 20.5, p3: 9.5 },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(created('p1')?.isStarter).toBe(true)
    expect(created('p3')?.isStarter).toBe(false)
  })

  /**
   * Sleeper returns a row for every week/roster whether or not it has been
   * played. Writing those zeroes would be indistinguishable from "he played and
   * scored nothing".
   */
  it('writes nothing for an unplayed week', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 0,
        starters: ['p1', 'p2'], starters_points: [0, 0],
        players: ['p1', 'p2'], players_points: { p1: 0, p2: 0 },
      },
    ])
    const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 14)
    expect(upsert).not.toHaveBeenCalled()
    expect(r.rostersSkippedUnscored).toBe(1)
    expect(r.scoresUpserted).toBe(0)
  })

  /** A real zero inside a played week IS a fact and must be kept. */
  it('keeps a genuine zero when the week was played', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1', 'p2'], starters_points: [20.5, 0],
        players: ['p1', 'p2'], players_points: { p1: 20.5, p2: 0 },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(written().sort()).toEqual(['p1', 'p2'])
    expect(created('p2')?.points).toBe(0)
  })

  /** "0" is Sleeper's empty-slot marker. A phantom player who scores is worse than a gap. */
  it('never writes a row for the "0" empty-slot marker', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1', '0'], starters_points: [20.5, 0],
        players: ['p1', '0'], players_points: { p1: 20.5, '0': 0 },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(written()).toEqual(['p1'])
  })

  /** Number(null) is 0, and a 0 would assert he scored nothing. Skip, don't coerce. */
  it('skips a non-finite value rather than coercing it to zero', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1'], starters_points: [20.5],
        players: ['p1', 'p2'],
        players_points: { p1: 20.5, p2: null as unknown as number },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(written()).toEqual(['p1'])
  })

  /** Nothing observed at ingestion can justify calling a score final — corrections run ~12h. */
  it('never writes isFinalized true', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1'], starters_points: [20.5],
        players: ['p1'], players_points: { p1: 20.5 },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(created('p1')?.isFinalized).toBe(false)
  })

  it('reports a provider failure instead of throwing past the caller', async () => {
    getLeagueMatchups.mockRejectedValue(new Error('sleeper 503'))
    const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(r.error).toContain('sleeper 503')
    expect(r.scoresUpserted).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
  })

  /** A shape change should be visible in the result, not produce a silent empty week. */
  it('counts a malformed players_points rather than swallowing it', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1'], starters_points: [20.5],
        players: ['p1'], players_points: undefined as unknown as Record<string, number>,
      },
    ])
    const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(r.rostersMalformed).toBe(1)
    expect(upsert).not.toHaveBeenCalled()
  })
})
