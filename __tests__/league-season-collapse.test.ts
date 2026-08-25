import { describe, expect, it } from 'vitest'

import { collapseLeagueSeasons } from '@/lib/dashboard/get-dashboard-league-list'

/**
 * The rail showed the same league once per season and it read as a duplicate
 * import. The database cannot actually hold a duplicate — `leagues` is unique
 * on (userId, platform, platformLeagueId, season) — but the SEASON is part of
 * that key, so a dynasty league is legitimately one row per year.
 *
 * These pin both halves: collapse the seasons, and never collapse two leagues
 * that merely look alike.
 */

const league = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  name: 'KBFL',
  platform: 'sleeper',
  platformLeagueId: '111',
  season: 2026,
  lastSyncedAt: null,
  ...over,
})

describe('collapseLeagueSeasons', () => {
  it('⚠ collapses one league across seasons to a single row', () => {
    const out = collapseLeagueSeasons([
      league({ id: 'a', season: 2024 }),
      league({ id: 'b', season: 2025 }),
      league({ id: 'c', season: 2026 }),
    ])
    expect(out).toHaveLength(1)
  })

  it('keeps the NEWEST season, which is the one being played', () => {
    const out = collapseLeagueSeasons([
      league({ id: 'old', season: 2024 }),
      league({ id: 'new', season: 2026 }),
      league({ id: 'mid', season: 2025 }),
    ])
    expect(out[0].id).toBe('new')
  })

  it('⚠ NEVER collapses two different leagues that share a name', () => {
    /*
     * A league series reuses its name and its crest. Grouping on either would
     * hide a league somebody actually plays in — a worse failure than the
     * duplicate-looking rail this exists to fix.
     */
    const out = collapseLeagueSeasons([
      league({ id: 'a', platformLeagueId: '111', name: 'KBFL' }),
      league({ id: 'b', platformLeagueId: '222', name: 'KBFL' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('never collapses two leagues that share a crest', () => {
    const out = collapseLeagueSeasons([
      league({ id: 'a', platformLeagueId: '111', avatarUrl: 'https://cdn/same.png' }),
      league({ id: 'b', platformLeagueId: '222', avatarUrl: 'https://cdn/same.png' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('keeps the same platform id on DIFFERENT platforms apart', () => {
    // Sleeper league 111 and an ESPN league 111 are unrelated.
    const out = collapseLeagueSeasons([
      league({ id: 'a', platform: 'sleeper', platformLeagueId: '111' }),
      league({ id: 'b', platform: 'espn', platformLeagueId: '111' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('passes through rows with no provider identity, ungrouped', () => {
    // AF-native leagues and tournaments have nothing to group on and must never
    // be grouped with each other.
    const out = collapseLeagueSeasons([
      { id: 'af1', name: 'Native A', platform: null, platformLeagueId: null, season: 2026 },
      { id: 'af2', name: 'Native B', platform: null, platformLeagueId: null, season: 2026 },
    ])
    expect(out).toHaveLength(2)
  })

  it('treats a missing season as older than any real one', () => {
    // A null season must never win over a dated row, or the rail shows the
    // least-known version of a league.
    const out = collapseLeagueSeasons([
      league({ id: 'nulls', season: null }),
      league({ id: 'real', season: 2026 }),
    ])
    expect(out[0].id).toBe('real')
  })

  it('accepts the snake_case spelling some rows carry', () => {
    const out = collapseLeagueSeasons([
      { id: 'a', platform: 'sleeper', platform_league_id: '111', season: 2025 },
      { id: 'b', platform: 'sleeper', platform_league_id: '111', season: 2026 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
  })

  it('is a no-op on an already-unique list', () => {
    const rows = [
      league({ id: 'a', platformLeagueId: '1' }),
      league({ id: 'b', platformLeagueId: '2' }),
      league({ id: 'c', platformLeagueId: '3' }),
    ]
    expect(collapseLeagueSeasons(rows)).toHaveLength(3)
  })

  it('survives an empty list', () => {
    expect(collapseLeagueSeasons([])).toEqual([])
  })
})
