import { describe, expect, it } from 'vitest'
import {
  pickRiSeasonRowPerPlayer,
  resolveNflDraftPoolAnalytics,
  RI_MIN_LEAD_OVER_SNAPSHOT_MS,
} from '@/lib/draft/analytics/nfl-rolling-insights-draft-analytics'

describe('resolveNflDraftPoolAnalytics', () => {
  const season = '2025'
  const snapTime = new Date('2025-01-01T00:00:00Z')
  const riTime = new Date(snapTime.getTime() + RI_MIN_LEAD_OVER_SNAPSHOT_MS + 1_000)

  it('keeps snapshot when RI is absent', () => {
    const r = resolveNflDraftPoolAnalytics({
      snapshot: { fantasyPointsPerGame: 14.2, lifetimeValue: 42, updatedAt: snapTime },
      rollingInsights: null,
      identityMatchConfidence: 'high',
      currentStatsSeason: season,
    })
    expect(r.primarySource).toBe('snapshot')
    expect(r.fantasyPointsPerGame).toBe(14.2)
    expect(r.lifetimeValue).toBe(42)
  })

  it('overrides PPG when RI is newer, confident, and season matches', () => {
    const r = resolveNflDraftPoolAnalytics({
      snapshot: { fantasyPointsPerGame: 12, lifetimeValue: 40, updatedAt: snapTime },
      rollingInsights: {
        fantasyPointsPerGame: 18.5,
        fantasyPointsSeason: 300,
        gamesPlayed: 15,
        season: season,
        updatedAt: riTime,
      },
      identityMatchConfidence: 'high',
      currentStatsSeason: season,
    })
    expect(r.primarySource).toBe('rolling_insights')
    expect(r.fantasyPointsPerGame).toBe(18.5)
    expect(r.lifetimeValue).toBe(40)
  })

  it('does not override when identity match is none', () => {
    const r = resolveNflDraftPoolAnalytics({
      snapshot: { fantasyPointsPerGame: 12, lifetimeValue: null, updatedAt: snapTime },
      rollingInsights: {
        fantasyPointsPerGame: 20,
        fantasyPointsSeason: 100,
        gamesPlayed: 15,
        season: season,
        updatedAt: riTime,
      },
      identityMatchConfidence: 'none',
      currentStatsSeason: season,
    })
    expect(r.primarySource).toBe('snapshot')
    expect(r.fantasyPointsPerGame).toBe(12)
    expect(r.rollingInsightsSupplemental?.fantasyPointsPerGame).toBe(20)
  })
})

describe('pickRiSeasonRowPerPlayer — newest usable SEASON, not newest write', () => {
  const row = (playerId: string, season: string, fppg: number | null, gp: number | null, updated: string) => ({
    playerId,
    season,
    fantasyPointsPerGame: fppg,
    gamesPlayed: gp,
    updatedAt: new Date(updated),
  })

  it('a re-touched 2024 row does not beat the 2025 row (production, Oct 2026)', () => {
    // 2024 rewritten Sep 19, 2025 written Sep 11: the old newest-write rule picked 2024.
    const picked = pickRiSeasonRowPerPlayer([
      row('jacobs', '2024', 17.95, 17, '2026-09-19T00:00:00Z'),
      row('jacobs', '2025', 15.2, 16, '2026-09-11T00:00:00Z'),
    ])
    expect(picked.get('jacobs')?.season).toBe('2025')
  })

  it('prefers the current season when it has a PPG', () => {
    const picked = pickRiSeasonRowPerPlayer([
      row('p', '2025', 15, 16, '2026-09-11T00:00:00Z'),
      row('p', '2026', 19, 5, '2026-10-01T00:00:00Z'),
    ])
    expect(picked.get('p')?.season).toBe('2026')
  })

  it('skips a newer season that cannot supply a PPG (no games yet) for an older one that can', () => {
    const picked = pickRiSeasonRowPerPlayer([
      row('p', '2026', null, 0, '2026-10-07T00:00:00Z'),
      row('p', '2025', 12.4, 14, '2026-09-11T00:00:00Z'),
    ])
    expect(picked.get('p')?.season).toBe('2025')
    // A PPG with zero games played is not a usable season either.
    const zeroGames = pickRiSeasonRowPerPlayer([
      row('z', '2026', 0, 0, '2026-10-07T00:00:00Z'),
      row('z', '2025', 12.4, 14, '2026-09-11T00:00:00Z'),
    ])
    expect(zeroGames.get('z')?.season).toBe('2025')
  })

  it('falls back to the newest season when no season has a PPG, and breaks a same-season tie by newest write', () => {
    const none = pickRiSeasonRowPerPlayer([
      row('q', '2024', null, null, '2026-09-19T00:00:00Z'),
      row('q', '2026', null, 0, '2026-10-07T00:00:00Z'),
    ])
    expect(none.get('q')?.season).toBe('2026')
    const tie = pickRiSeasonRowPerPlayer([
      row('r', '2025', 10, 10, '2026-09-01T00:00:00Z'),
      row('r', '2025', 11, 11, '2026-09-11T00:00:00Z'),
    ])
    expect(tie.get('r')?.fantasyPointsPerGame).toBe(11)
  })

  it('keeps players separate', () => {
    const picked = pickRiSeasonRowPerPlayer([row('a', '2025', 9, 9, '2026-09-11T00:00:00Z'), row('b', '2024', 8, 8, '2026-09-19T00:00:00Z')])
    expect([...picked.keys()].sort()).toEqual(['a', 'b'])
  })
})
