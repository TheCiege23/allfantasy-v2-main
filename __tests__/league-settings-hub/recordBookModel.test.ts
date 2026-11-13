import { describe, expect, it } from 'vitest'
import { summarizeCorrectionWeeks, topPlayerScores } from '@/lib/league-settings-hub/recordBookModel'

const teams = new Map([['A', { key: 'A', name: 'Blitz Brigade' }], ['B', { key: 'B', name: 'Ghost Protocol' }]])
const names = new Map([['p1', 'J. Allen'], ['p2', 'J. Gibbs'], ['p3', 'J. Chase']])

describe('topPlayerScores', () => {
  it('ranks starter weeks only, highest first, with team and week', () => {
    const rows = topPlayerScores({
      teams,
      playerNames: names,
      playerWeeks: [
        { season: 2025, week: 3, team: 'A', playerId: 'p1', points: 41.2, starter: true },
        { season: 2026, week: 1, team: 'B', playerId: 'p2', points: 55.555, starter: true },
        { season: 2026, week: 2, team: 'B', playerId: 'p3', points: 60, starter: false }, // bench never counts
      ],
    })
    expect(rows.map((r) => [r.rank, r.playerName, r.teamName, r.points])).toEqual([
      [1, 'J. Gibbs', 'Ghost Protocol', 55.56],
      [2, 'J. Allen', 'Blitz Brigade', 41.2],
    ])
  })

  it('drops unnamed players and teams the loader could not map, and respects the limit', () => {
    const rows = topPlayerScores({
      teams,
      playerNames: names,
      playerWeeks: [
        { season: 2026, week: 1, team: 'A', playerId: 'unknown', points: 70, starter: true },
        { season: 2026, week: 1, team: 'Z', playerId: 'p1', points: 65, starter: true },
        { season: 2026, week: 2, team: 'A', playerId: 'p1', points: 30, starter: true },
        { season: 2026, week: 3, team: 'A', playerId: 'p2', points: 20, starter: true },
      ],
    }, 1)
    expect(rows).toEqual([{ rank: 1, playerId: 'p1', playerName: 'J. Allen', teamName: 'Blitz Brigade', season: 2026, week: 2, points: 30 }])
  })

  it('breaks ties toward the newer season, then the earlier week', () => {
    const rows = topPlayerScores({
      teams,
      playerNames: names,
      playerWeeks: [
        { season: 2025, week: 1, team: 'A', playerId: 'p1', points: 40, starter: true },
        { season: 2026, week: 9, team: 'A', playerId: 'p2', points: 40, starter: true },
        { season: 2026, week: 4, team: 'B', playerId: 'p3', points: 40, starter: true },
      ],
    })
    expect(rows.map((r) => r.playerId)).toEqual(['p3', 'p2', 'p1'])
  })
})

describe('summarizeCorrectionWeeks', () => {
  it('marks a week final only when no stored score is still open', () => {
    const weeks = summarizeCorrectionWeeks(
      [
        { week: 1, isFinalized: true, count: 120 },
        { week: 2, isFinalized: true, count: 100 },
        { week: 2, isFinalized: false, count: 20 },
        { week: 3, isFinalized: false, count: 118 },
      ],
      [],
    )
    expect(weeks.map((w) => [w.week, w.final])).toEqual([[1, true], [2, false], [3, false]])
  })

  it('attaches the latest rescore per week, including a week with no stored scores', () => {
    const weeks = summarizeCorrectionWeeks(
      [{ week: 1, isFinalized: true, count: 10 }],
      [
        { week: 1, createdAt: new Date('2026-09-10T10:00:00Z') },
        { week: 1, createdAt: new Date('2026-09-12T10:00:00Z') },
        { week: 4, createdAt: new Date('2026-10-01T10:00:00Z') },
      ],
    )
    expect(weeks).toEqual([
      { week: 1, final: true, rescoredAt: '2026-09-12T10:00:00.000Z' },
      { week: 4, final: false, rescoredAt: '2026-10-01T10:00:00.000Z' },
    ])
  })
})

describe('topTeamScores', () => {
  it('ranks both sides of every FINAL fixture and ignores live or scheduled games', async () => {
    const { topTeamScores } = await import('@/lib/league-settings-hub/recordBookModel')
    const rows = topTeamScores({
      teams,
      fixtures: [
        { season: 2025, week: 3, a: 'A', b: 'B', scoreA: 150.5, scoreB: 162.25, final: true },
        { season: 2026, week: 1, a: 'A', b: 'B', scoreA: 199, scoreB: 80, final: false }, // live — not a result
        { season: 2026, week: 2, a: 'B', b: 'Z', scoreA: 140, scoreB: 170, final: true }, // Z is not a mapped team
      ],
    })
    expect(rows.map((r) => [r.rank, r.teamName, r.season, r.week, r.points])).toEqual([
      [1, 'Ghost Protocol', 2025, 3, 162.25],
      [2, 'Blitz Brigade', 2025, 3, 150.5],
      [3, 'Ghost Protocol', 2026, 2, 140],
    ])
  })
})
