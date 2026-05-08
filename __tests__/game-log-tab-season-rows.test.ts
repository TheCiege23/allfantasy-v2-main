import { describe, it, expect } from 'vitest'

import { toSeasonRows, pickStatNum } from '@/app/player/[playerId]/tabs/seasonRows'

const burrow = [
  {
    season: '2025',
    gamesPlayed: 8,
    fantasyPoints: 145.46,
    fantasyPointsPerGame: 18.18,
    team: 'CIN',
    stats: { passing_yards: 1809, passing_touchdowns: 17, passing_interceptions: 5 },
  },
  {
    season: '2024',
    gamesPlayed: 17,
    fantasyPoints: 407.82,
    fantasyPointsPerGame: 23.99,
    team: 'CIN',
    stats: { passing_yards: 4918, passing_touchdowns: 43 },
  },
  {
    season: '2023',
    gamesPlayed: 10,
    fantasyPoints: 163.16,
    fantasyPointsPerGame: 16.32,
    team: 'CIN',
    stats: { passing_yards: 2309 },
  },
]

describe('GameLogTab seasonRows adapter', () => {
  it('reads the documented `seasonHistory` server key', () => {
    const rows = toSeasonRows({ seasonHistory: burrow })
    expect(rows.map((r) => r.season)).toEqual(['2025', '2024', '2023'])
    expect(rows[0]?.fantasyPoints).toBeCloseTo(145.46)
    expect(rows[1]?.stats.passing_yards).toBe(4918)
  })

  it('falls back to the legacy `seasonStats` key so older clients keep working', () => {
    const rows = toSeasonRows({ seasonStats: burrow })
    expect(rows).toHaveLength(3)
    expect(rows[0]?.season).toBe('2025')
  })

  it('returns no rows when both keys are absent (the bug this PR fixes)', () => {
    expect(toSeasonRows({})).toEqual([])
    expect(toSeasonRows(null)).toEqual([])
    expect(toSeasonRows(undefined)).toEqual([])
  })

  it('sorts seasons descending so the most recent is selected by default', () => {
    const rows = toSeasonRows({
      seasonHistory: [burrow[2], burrow[0], burrow[1]],
    })
    expect(rows.map((r) => r.season)).toEqual(['2025', '2024', '2023'])
  })

  it('coerces numeric season values to strings without dropping the row', () => {
    const rows = toSeasonRows({
      seasonHistory: [{ ...burrow[0], season: 2025 }],
    })
    expect(rows[0]?.season).toBe('2025')
  })

  it('drops malformed rows (missing season, wrong shape) without throwing', () => {
    const rows = toSeasonRows({
      seasonHistory: [burrow[0], null, { foo: 'bar' }, { ...burrow[1], season: null }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.season).toBe('2025')
  })

  it('normalizes missing optional fields to null and missing stats to {}', () => {
    const rows = toSeasonRows({
      seasonHistory: [{ season: '2024' }],
    })
    expect(rows[0]).toEqual({
      season: '2024',
      gamesPlayed: null,
      fantasyPoints: null,
      fantasyPointsPerGame: null,
      team: null,
      stats: {},
    })
  })
})

describe('GameLogTab pickStatNum', () => {
  it('returns the first finite numeric value for the given keys', () => {
    expect(pickStatNum({ passing_interceptions: 5 }, 'passing_interceptions', 'interceptions')).toBe(5)
    expect(pickStatNum({ interceptions: 3 }, 'passing_interceptions', 'interceptions')).toBe(3)
  })

  it('returns null when no key resolves to a finite number', () => {
    expect(pickStatNum({}, 'passing_yards')).toBeNull()
    expect(pickStatNum({ passing_yards: 'huge' }, 'passing_yards')).toBeNull()
    expect(pickStatNum({ passing_yards: NaN }, 'passing_yards')).toBeNull()
  })
})
