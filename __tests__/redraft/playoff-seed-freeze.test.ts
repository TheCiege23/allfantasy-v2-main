/**
 * Playoff seeds are settled once the playoffs start.
 *
 * `updateStandings` used to rewrite `RedraftRoster.playoffSeed` from the whole-season order on every
 * recompute, playoffs included — handing seeds to eliminated teams and reshuffling the field that
 * reseeding reads back. Now W-L, points and streaks keep updating, and the seed is held once a bracket
 * exists for the season or the recomputed week is on or after `playoffStartWeek`. A rotisserie season
 * keeps its category rank in that column all season, so only a bracket freezes it there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Update = { where: { id: string }; data: Record<string, unknown> }

const h = vi.hoisted(() => ({
  updates: [] as Update[],
  rosters: [] as Array<{ id: string; ownerId: string }>,
  matchups: [] as unknown[],
  season: {} as Record<string, unknown>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRoster: {
      findMany: vi.fn(async () => h.rosters),
      update: vi.fn(async (args: Update) => {
        h.updates.push(args)
        return {}
      }),
    },
    redraftMatchup: { findMany: vi.fn(async () => h.matchups), updateMany: vi.fn(async () => ({ count: 0 })) },
    redraftSeason: { findUnique: vi.fn(async () => h.season) },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'roster-a', platformUserId: 'user-a', redraftRosterId: 'rr-a' },
        { id: 'roster-b', platformUserId: 'user-b', redraftRosterId: 'rr-b' },
      ]),
    },
    teamWeekResult: {
      findMany: vi.fn(async () => [
        { rosterId: 'roster-a', week: 1, categoryBreakdown: { teamStats: { h: 1, ab: 2, hr: 2, r: 3, rbi: 3, sb: 2, outs: 18, er: 1, p_h: 2, p_bb: 1, so: 10, w: 1, sv: 1 } } },
        { rosterId: 'roster-b', week: 1, categoryBreakdown: { teamStats: { h: 3, ab: 10, hr: 1, r: 1, rbi: 1, sb: 1, outs: 18, er: 3, p_h: 4, p_bb: 1, so: 6, w: 0, sv: 0 } } },
      ]),
    },
    // Not a native league, so the LeagueTeam mirror steps aside.
    league: { findFirst: vi.fn(async () => ({ platform: 'sleeper', settings: {} })) },
    fantasyStanding: { upsert: vi.fn() },
    leagueTeam: { updateMany: vi.fn() },
  },
}))
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }),
  EVENT: { STANDINGS_UPDATED: 'standings.updated' },
}))

import { playoffSeedsFrozen, updateStandings } from '@/lib/redraft/standingsEngine'

const data = (id: string) => h.updates.find((u) => u.where.id === id)!.data
const seeds = () => Object.fromEntries(h.updates.map((u) => [u.where.id, u.data.playoffSeed]))

const H2H_ROSTERS = ['a', 'b', 'c', 'd'].map((id) => ({ id, ownerId: `user-${id}` }))
const H2H_MATCHUPS = [
  { id: 'm1', week: 1, homeRosterId: 'a', awayRosterId: 'b', homeScore: 120, awayScore: 90, status: 'final' },
  { id: 'm2', week: 1, homeRosterId: 'c', awayRosterId: 'd', homeScore: 80, awayScore: 100, status: 'final' },
]
const h2hSeason = (extra: Record<string, unknown> = {}) => ({
  leagueId: 'L', season: 2026, medianGame: false, playoffStartWeek: 2, playoffBracket: null,
  league: { medianGame: false, settings: {}, playoffSeedingRule: null }, ...extra,
})
const rotoSeason = (extra: Record<string, unknown> = {}) => ({
  leagueId: 'L', season: 2027, medianGame: false, playoffStartWeek: 2, playoffBracket: null,
  league: { medianGame: false, settings: { scoring_mode: 'roto', category_preset_id: 'mlb_5x5' }, playoffSeedingRule: null }, ...extra,
})

beforeEach(() => {
  h.updates = []
  h.rosters = H2H_ROSTERS
  h.matchups = H2H_MATCHUPS
  h.season = h2hSeason()
})

describe('playoffSeedsFrozen', () => {
  it('a bracket freezes every format; the start week freezes head-to-head only', () => {
    expect(playoffSeedsFrozen({ week: 1, playoffStartWeek: 15, bracketExists: true, roto: false })).toBe(true)
    expect(playoffSeedsFrozen({ week: 1, playoffStartWeek: 15, bracketExists: true, roto: true })).toBe(true)
    expect(playoffSeedsFrozen({ week: 15, playoffStartWeek: 15, bracketExists: false, roto: false })).toBe(true)
    expect(playoffSeedsFrozen({ week: 14, playoffStartWeek: 15, bracketExists: false, roto: false })).toBe(false)
    expect(playoffSeedsFrozen({ week: 20, playoffStartWeek: 15, bracketExists: false, roto: true })).toBe(false)
    expect(playoffSeedsFrozen({ week: 20, playoffStartWeek: null, bracketExists: false, roto: false })).toBe(false)
    expect(playoffSeedsFrozen({ week: 20, playoffStartWeek: 0, bracketExists: false, roto: false })).toBe(false)
  })
})

describe('head-to-head', () => {
  it('regular season: seeds are written in standings order, as before (positive control)', async () => {
    await updateStandings('s', 1)
    expect(seeds()).toEqual({ a: 1, d: 2, b: 3, c: 4 })
  })

  it('a playoff week: W-L still updates, the seed column is never written', async () => {
    h.matchups = [...H2H_MATCHUPS, { id: 'm3', week: 2, homeRosterId: 'b', awayRosterId: 'a', homeScore: 150, awayScore: 60, status: 'final' }]
    await updateStandings('s', 2)
    expect(data('b')).toMatchObject({ wins: 1, losses: 1, streak: 'W1' })
    expect(data('a')).toMatchObject({ wins: 1, losses: 1, streak: 'L1' })
    for (const u of h.updates) expect('playoffSeed' in u.data).toBe(false)
  })

  it('a bracket exists: even a regular-season recompute (a late correction) leaves the seeds alone', async () => {
    h.season = h2hSeason({ playoffStartWeek: 15, playoffBracket: { id: 'bracket-1' } })
    await updateStandings('s', 1)
    expect(data('a')).toMatchObject({ wins: 1, losses: 0 })
    for (const u of h.updates) expect('playoffSeed' in u.data).toBe(false)
  })
})

describe('rotisserie', () => {
  beforeEach(() => {
    h.rosters = [{ id: 'rr-a', ownerId: 'user-a' }, { id: 'rr-b', ownerId: 'user-b' }]
    h.matchups = []
  })

  it('keeps writing its category rank to playoffSeed past a start week, with no bracket', async () => {
    h.season = rotoSeason()
    await updateStandings('s', 2)
    expect(data('rr-a')).toMatchObject({ pointsFor: 20 })
    expect(seeds()).toEqual({ 'rr-a': 1, 'rr-b': 2 })
  })

  it('a bracket freezes it', async () => {
    h.season = rotoSeason({ playoffBracket: { id: 'bracket-1' } })
    await updateStandings('s', 2)
    expect(data('rr-a')).toMatchObject({ pointsFor: 20 })
    for (const u of h.updates) expect('playoffSeed' in u.data).toBe(false)
  })
})
