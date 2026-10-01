// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildRatingInputs, makeCompleteWeekTest, type FactRow, type LeagueMeta } from '@/lib/class-rating/inputs'

const row = (over: Partial<FactRow>): FactRow => ({
  leagueId: 'L1',
  platform: 'sleeper',
  platformLeagueId: 'P1',
  season: 2025,
  week: 1,
  userA: 'ua',
  userB: 'ub',
  claimA: null,
  claimB: null,
  scoreA: 110,
  scoreB: 100,
  winnerTeamId: '1',
  ...over,
})

const meta = (leagueId: string, season: number | null, currentWeek?: number): [string, LeagueMeta] => [
  leagueId,
  { leagueId, season, settings: currentWeek == null ? {} : { current_week: currentWeek } },
]

describe('makeCompleteWeekTest — never rate a week still being played', () => {
  it('in the league’s current season, rates only weeks before its stated current week', () => {
    const rows = [1, 2, 3, 4].map((week) => row({ season: 2026, week }))
    const done = makeCompleteWeekTest(rows, new Map([meta('L1', 2026, 4)]))
    expect([1, 2, 3, 4].map((week) => done({ leagueId: 'L1', season: 2026, week }))).toEqual([true, true, true, false])
  })

  it('🛑 holds back an in-progress week that already has points on every row', () => {
    // Thursday night of week 4: every week-4 row is "scored", which the shared frontier rule reads as done.
    const rows = [1, 2, 3, 4].map((week) => row({ season: 2026, week, scoreA: 30, scoreB: 12 }))
    const done = makeCompleteWeekTest(rows, new Map([meta('L1', 2026, 4)]))
    expect(done({ leagueId: 'L1', season: 2026, week: 4 })).toBe(false)
  })

  it('without a stated week, holds back the newest scored week', () => {
    const rows = [...[1, 2, 3].map((week) => row({ season: 2026, week })), row({ season: 2026, week: 4, scoreA: 0, scoreB: 0, winnerTeamId: null })]
    const done = makeCompleteWeekTest(rows, new Map([meta('L1', 2026)]))
    expect([1, 2, 3].map((week) => done({ leagueId: 'L1', season: 2026, week }))).toEqual([true, true, false])
  })

  it('treats every earlier season as finished, and every season once the league has rolled over', () => {
    const rows = [row({ season: 2024, week: 17 }), row({ season: 2025, week: 3 })]
    const done = makeCompleteWeekTest(rows, new Map([meta('L1', 2025, 4)]))
    expect(done({ leagueId: 'L1', season: 2024, week: 17 })).toBe(true)
    const rolled = makeCompleteWeekTest([row({ season: 2025, week: 17 })], new Map([meta('L1', 2026, 1)]))
    expect(rolled({ leagueId: 'L1', season: 2025, week: 17 })).toBe(true)
  })
})

describe('buildRatingInputs — the binding drop rules (ADR F2.10a)', () => {
  const leagues = new Map([meta('L1', 2025, 18), meta('L2', 2025, 18), meta('L3', 2025, 18)])

  it('drops unplayed fixtures, unresolved slots and self-games, and counts each', () => {
    const { games, counts } = buildRatingInputs(
      [
        row({}),
        row({ week: 2, scoreA: 0, scoreB: 0, winnerTeamId: null }),
        row({ week: 3, userB: null }),
        row({ week: 4, userB: 'ua' }),
      ],
      leagues,
    )
    expect(games).toHaveLength(1)
    expect(counts).toMatchObject({ rows: 4, unplayed: 1, unresolved: 1, selfGames: 1, kept: 1 })
    expect(games[0]).toMatchObject({ a: 'sleeper:ua', b: 'sleeper:ub' })
  })

  it('keeps ONE AF row per platform league — the one with most rows — and drops content duplicates', () => {
    const { games, counts } = buildRatingInputs(
      [
        // L1 and L2 are the same Sleeper league imported by two users; L1 has more rows.
        row({ leagueId: 'L1', week: 1 }),
        row({ leagueId: 'L1', week: 2 }),
        row({ leagueId: 'L2', week: 1 }),
        // L3 is a different platform id holding the same game by content.
        row({ leagueId: 'L3', platformLeagueId: 'P3', week: 1 }),
      ],
      leagues,
    )
    expect(counts).toMatchObject({ duplicateLeagueRows: 1, duplicateContent: 1, kept: 2 })
    expect(games.map((g) => g.leagueId)).toEqual(['L1', 'L1'])
  })

  it('names the claiming account seen on most of a person’s games', () => {
    const { claimedBy } = buildRatingInputs(
      [row({ week: 1, claimA: 'af1' }), row({ week: 2, claimA: 'af1' }), row({ week: 3, claimA: 'af2' })],
      leagues,
    )
    expect(claimedBy.get('sleeper:ua')).toBe('af1')
    expect(claimedBy.has('sleeper:ub')).toBe(false)
  })

  it('hashes the input: same games in any order agree; a changed score or claim does not', () => {
    const rows = [row({ week: 1 }), row({ week: 2, scoreA: 90 })]
    const base = buildRatingInputs(rows, leagues).inputHash
    expect(buildRatingInputs([...rows].reverse(), leagues).inputHash).toBe(base)
    expect(buildRatingInputs([row({ week: 1 }), row({ week: 2, scoreA: 91 })], leagues).inputHash).not.toBe(base)
    expect(buildRatingInputs([row({ week: 1, claimA: 'af9' }), row({ week: 2, scoreA: 90 })], leagues).inputHash).not.toBe(base)
  })

  it('holds back an incomplete week and says so', () => {
    const { counts } = buildRatingInputs([row({ season: 2026, week: 4 })], new Map([meta('L1', 2026, 4)]))
    expect(counts).toMatchObject({ incompleteWeek: 1, kept: 0 })
  })
})
