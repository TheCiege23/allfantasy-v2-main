import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * AllFantasy's own projection on the draft boards (live grid, Draft HQ's completed board, your
 * picks). The weekly AF number is the same one every other /core surface shows; the season total
 * comes from the engine's baseline row, reached through the canonical id the weekly mirror records.
 */

const h = vi.hoisted(() => ({
  latest: vi.fn(),
  providers: vi.fn(),
  engine: vi.fn(),
  snapshots: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { aFProjectionSnapshot: { findMany: h.snapshots } } }))
vi.mock('@/lib/projections/leagueScoring', () => ({
  // rec x the league's `rec` — enough to make league scoring differ from generic PPR.
  extractScoringSettings: (s: { scoring_settings?: Record<string, number> } | null) => s?.scoring_settings ?? null,
  computeLeagueProjectedPoints: (line: Record<string, number>, scoring: Record<string, number>) => ({
    points: Number(line.rec) * Number(scoring.rec ?? 1),
  }),
}))
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  afEngineForLeague: (await importOriginal<typeof import('@/lib/core-app/playerProjections')>()).afEngineForLeague,
  latestProjectionWeek: h.latest,
  lookupProjections: h.providers,
  lookupAfEngineProjections: h.engine,
}))

import { loadDraftAfProjections } from '@/lib/core-app/draftAfProjections'
import { draftAfText, draftAfTitle } from '@/lib/core-app/draftAfLabel'

const SETTINGS = { scoring_settings: { rec: 2 } }

beforeEach(() => {
  h.latest.mockReset().mockResolvedValue({ season: '2026', week: 4 })
  // Provider: 10 generic PPR, league-scored 5 x 2 = 10 -> ratio 1. '200': 8 generic -> 4 x 2 = 8.
  h.providers.mockReset().mockResolvedValue(new Map([
    ['100', { projectedPoints: 10, componentStats: { rec: 5 } }],
    ['200', { projectedPoints: 4, componentStats: { rec: 4 } }],
  ]))
  h.engine.mockReset().mockResolvedValue(new Map([
    ['100', { playerId: '100', projectedPoints: 12, basis: null, confidence: null, canonicalPlayerId: 'uuid-100' }],
    ['200', { playerId: '200', projectedPoints: 5, basis: null, confidence: null, canonicalPlayerId: null }],
  ]))
  h.snapshots.mockReset().mockResolvedValue([
    { playerId: 'uuid-100', rosProjection: 212.44, rosWeeksRemaining: 14 },
    // An older baseline for the same player must not win — the read orders freshest first.
    { playerId: 'uuid-100', rosProjection: 1, rosWeeksRemaining: 1 },
  ])
})

describe('loadDraftAfProjections', () => {
  it('gives each pick the weekly AF under league scoring, and the season total via the canonical id', async () => {
    const r = await loadDraftAfProjections({ platform: 'sleeper', playerIds: ['100', '200', '300', null], leagueSettings: SETTINGS })
    expect(r.week).toBe(4)
    // 12 x (10 / 10) = 12; the provider's league/PPR ratio carries it.
    expect(r.byPlayerId.get('100')).toEqual({ af: 12, ros: 212.4, rosWeeks: 14, week: 4 })
    // 5 x (8 / 4) = 10; no canonical id, so no season total — never a borrowed one.
    expect(r.byPlayerId.get('200')).toEqual({ af: 10, ros: null, rosWeeks: null, week: 4 })
    // The engine has no row for him: absent, not zero.
    expect(r.byPlayerId.has('300')).toBe(false)
    expect(h.snapshots.mock.calls[0][0].where).toEqual({ playerId: { in: ['uuid-100'] }, season: 2026, week: null })
  })

  it('🛑 reads nothing for a league whose pick ids are not Sleeper ids', async () => {
    for (const platform of ['espn', 'fleaflicker', 'mfl', 'yahoo', 'fantrax']) {
      const r = await loadDraftAfProjections({ platform, playerIds: ['100'], leagueSettings: SETTINGS })
      expect(r.byPlayerId.size).toBe(0)
    }
    expect(h.engine).not.toHaveBeenCalled()
    // CONTROL: a native league speaks Sleeper ids and IS read.
    const native = await loadDraftAfProjections({ platform: 'manual', playerIds: ['100'], leagueSettings: SETTINGS })
    expect(native.byPlayerId.get('100')?.af).toBe(12)
  })

  it('degrades to no AF, never an error, when a read fails', async () => {
    h.snapshots.mockRejectedValue(new Error('db down'))
    const r = await loadDraftAfProjections({ platform: 'sleeper', playerIds: ['100'], leagueSettings: SETTINGS })
    expect(r.byPlayerId.get('100')).toEqual({ af: 12, ros: null, rosWeeks: null, week: 4 })
    h.engine.mockRejectedValue(new Error('db down'))
    const none = await loadDraftAfProjections({ platform: 'sleeper', playerIds: ['100'], leagueSettings: SETTINGS })
    expect(none.byPlayerId.size).toBe(0)
  })
})

describe('draftAfText / draftAfTitle', () => {
  it('says the weekly number in the cell, and the week and PPR season total on hover', () => {
    const af = { af: 12, ros: 212.4, rosWeeks: 14, week: 4 }
    expect(draftAfText(af)).toBe('AF 12.0')
    expect(draftAfTitle(af)).toBe(
      "AllFantasy projection, week 4: 12.0 under this league's scoring · rest of season 212.4 PPR over 14 games",
    )
    expect(draftAfText(undefined)).toBeNull()
    expect(draftAfText({ af: null, ros: 50, rosWeeks: 10, week: 4 })).toBeNull()
  })
})
