import { describe, expect, it } from 'vitest'
import {
  buildPlatformHealth,
  buildWireLeagues,
  decorateChanges,
  latestSeasonOnly,
  leagueWireStatus,
  readAgo,
  runKeyFor,
  type WireLeagueInput,
  type WireSyncState,
} from '@/lib/core-app/careerWireModel'
import { LEAGUE_GONE_ERROR_PREFIX } from '@/lib/import-os/collector/leagueGone'

const NOW = new Date('2026-10-04T18:00:00Z')
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

const league = (over: Partial<WireLeagueInput> = {}): WireLeagueInput => ({
  id: 'L1',
  name: 'Dynasty Dragons',
  platform: 'sleeper',
  platformLeagueId: '998',
  season: 2026,
  sport: 'NFL',
  lastSyncedAt: null,
  ...over,
})

const state = (over: Partial<WireSyncState> = {}): WireSyncState => ({
  runKey: 'sleeper:998:2026',
  lastSuccessfulSyncAt: minsAgo(10),
  lastAttemptedSyncAt: minsAgo(10),
  consecutiveFailures: 0,
  syncStatus: 'completed',
  lastError: null,
  seasonState: 'regular_season',
  ...over,
})

describe('runKeyFor', () => {
  it('matches the collector key and skips native leagues', () => {
    expect(runKeyFor(league())).toBe('sleeper:998:2026')
    expect(runKeyFor(league({ platform: 'manual', platformLeagueId: 'manual-1' }))).toBeNull()
  })
})

describe('leagueWireStatus', () => {
  const status = (full: WireSyncState | null, over: Partial<Parameters<typeof leagueWireStatus>[0]> = {}) =>
    leagueWireStatus({ league: league(), full, active: null, paused: false, now: NOW, ...over }).status

  it('calls a native league native, with no read time', () => {
    expect(leagueWireStatus({ league: league({ platform: 'manual' }), full: null, active: null, paused: false, now: NOW }))
      .toEqual({ status: 'native', lastReadAt: null })
  })

  it('is current inside the in-season window and delayed past it', () => {
    expect(status(state())).toBe('ok')
    expect(status(state({ lastSuccessfulSyncAt: minsAgo(60) }))).toBe('delayed')
    expect(status(state({ lastSuccessfulSyncAt: minsAgo(120) }))).toBe('attention')
  })

  it('uses the lenient off-season window, so a quiet off-season is not red', () => {
    expect(status(state({ seasonState: 'offseason', lastSuccessfulSyncAt: minsAgo(120) }))).toBe('ok')
  })

  it('takes the newer of the two lanes', () => {
    const full = state({ lastSuccessfulSyncAt: minsAgo(500) })
    const active = state({ runKey: 'sleeper:998:2026:active', lastSuccessfulSyncAt: minsAgo(5) })
    expect(leagueWireStatus({ league: league(), full, active, paused: false, now: NOW })).toEqual({
      status: 'ok',
      lastReadAt: minsAgo(5),
    })
  })

  it('flags consecutive failures even on a fresh read', () => {
    expect(status(state({ consecutiveFailures: 2 }))).toBe('attention')
  })

  it('reports never-read, paused and gone in that precedence', () => {
    expect(status(null)).toBe('never')
    expect(status(state({ consecutiveFailures: 3 }), { paused: true })).toBe('paused')
    expect(
      status(state({ syncStatus: 'skipped', lastError: `${LEAGUE_GONE_ERROR_PREFIX}404`, lastAttemptedSyncAt: minsAgo(1) })),
    ).toBe('gone')
  })
})

describe('latestSeasonOnly', () => {
  it('keeps the newest season per sport and rows with no season', () => {
    const rows = [
      league({ id: 'a', season: 2025 }),
      league({ id: 'b', season: 2026 }),
      league({ id: 'c', season: 2025, sport: 'NBA' }),
      league({ id: 'd', season: null }),
    ]
    expect(latestSeasonOnly(rows).map((r) => r.id)).toEqual(['b', 'c', 'd'])
  })
})

describe('buildWireLeagues + buildPlatformHealth', () => {
  const leagues = [
    league({ id: 'S1', name: 'Alpha' }),
    league({ id: 'S2', name: 'Bravo', platformLeagueId: '999' }),
    league({ id: 'E1', name: 'Work League', platform: 'espn', platformLeagueId: '55' }),
    league({ id: 'N1', name: 'AF Founders', platform: 'manual', platformLeagueId: 'manual-1' }),
  ]
  const states = new Map<string, WireSyncState>([
    ['sleeper:998:2026', state()],
    ['sleeper:999:2026', state({ runKey: 'sleeper:999:2026', consecutiveFailures: 1 })],
    ['espn:55:2026', state({ runKey: 'espn:55:2026', lastSuccessfulSyncAt: minsAgo(60) })],
  ])
  const standings = {
    S1: { rank: 2, wins: 3, losses: 1, ties: 0 },
    S2: { rank: 1, wins: 0, losses: 0, ties: 0 },
    N1: { rank: 4, wins: 2, losses: 2, ties: 0 },
  }
  const wire = buildWireLeagues({ leagues, states, pausedLeagueIds: new Set(), standings, now: NOW })

  it('gives each league its record, and no rank before a game is played', () => {
    expect(wire.find((l) => l.leagueId === 'S1')).toMatchObject({ record: '3-1', rank: 2, status: 'ok' })
    expect(wire.find((l) => l.leagueId === 'S2')).toMatchObject({ record: null, rank: null, status: 'attention' })
    expect(wire.find((l) => l.leagueId === 'N1')).toMatchObject({ platform: 'allfantasy', status: 'native' })
  })

  it('rolls leagues up per platform, problems first', () => {
    const health = buildPlatformHealth(wire)
    expect(health.map((p) => [p.label, p.status, p.leagues, p.needsAttention])).toEqual([
      ['Sleeper', 'attention', 2, 1],
      ['ESPN', 'delayed', 1, 0],
      ['AllFantasy', 'native', 1, 0],
    ])
    const sleeper = health[0]
    expect(sleeper.lastReadAt).toBe(minsAgo(10).toISOString())
  })

  it('reads a platform whose every league is paused as paused', () => {
    const paused = buildWireLeagues({ leagues: [leagues[2]], states, pausedLeagueIds: new Set(['E1']), standings, now: NOW })
    expect(buildPlatformHealth(paused)[0]).toMatchObject({ status: 'paused', paused: 1, needsAttention: 0 })
  })
})

describe('decorateChanges', () => {
  it('adds the platform and an unsent Chimmy question, results first', () => {
    const changes = decorateChanges(
      [
        { leagueId: 'S1', leagueName: 'Alpha', wins: 4, losses: 1, ties: 0, won: 1, lost: 0, tied: 0, rank: 1, previousRank: 2 },
        { leagueId: 'E1', leagueName: 'Work League', wins: 2, losses: 2, ties: 0, won: 0, lost: 0, tied: 0, rank: 3, previousRank: 5 },
      ],
      [
        { leagueId: 'S1', leagueName: 'Alpha', platform: 'sleeper', status: 'ok', lastReadAt: null, record: '4-1', rank: 1 },
        { leagueId: 'E1', leagueName: 'Work League', platform: 'espn', status: 'ok', lastReadAt: null, record: '2-2', rank: 3 },
      ],
    )
    expect(changes.map((c) => [c.leagueId, c.platform])).toEqual([
      ['S1', 'sleeper'],
      ['E1', 'espn'],
    ])
    expect(changes[0].ask).toBe("In Alpha I went 1-0 since I last checked and I'm #1 now (4-1). What should I focus on this week?")
    expect(changes[1].ask).toContain('moved in the standings')
  })
})

describe('readAgo', () => {
  it('words a read time, and an absent one as not read', () => {
    expect(readAgo(null, NOW)).toBe('not read yet')
    expect(readAgo(minsAgo(0).toISOString(), NOW)).toBe('just now')
    expect(readAgo(minsAgo(12).toISOString(), NOW)).toBe('12m ago')
    expect(readAgo(minsAgo(180).toISOString(), NOW)).toBe('3h ago')
    expect(readAgo(minsAgo(60 * 72).toISOString(), NOW)).toBe('3d ago')
  })
})
