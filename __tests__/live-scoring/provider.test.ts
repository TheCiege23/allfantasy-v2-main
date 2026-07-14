/**
 * Live-stats provider boundary — deterministic unit tests (G11 Phase 3b).
 * Covers status normalization, game→snapshot mapping (clock gap = null), team
 * extraction, and the fixture provider's player-id scoping.
 */
import { describe, expect, it } from 'vitest'
import {
  gamesToSnapshots,
  teamsInGames,
  FixtureLiveStatsProvider,
  type LiveGameLite,
} from '@/lib/live-scoring/provider'

const games: LiveGameLite[] = [
  { gameId: 'KC@BUF', homeTeam: 'BUF', awayTeam: 'KC', status: 'in_progress', startTime: new Date('2026-09-13T17:00:00Z') },
  { gameId: 'GB@CHI', homeTeam: 'CHI', awayTeam: 'GB', status: 'final', startTime: new Date('2026-09-13T17:00:00Z') },
]

describe('gamesToSnapshots', () => {
  it('maps games to snapshots and leaves fractionElapsed null (no clock feed)', () => {
    const snaps = gamesToSnapshots(games)
    expect(snaps).toHaveLength(2)
    expect(snaps[0]).toMatchObject({ gameId: 'KC@BUF', status: 'in_progress' })
    expect(snaps[0].fractionElapsed).toBeNull()
  })
})

describe('teamsInGames', () => {
  it('returns the uppercased set of teams playing', () => {
    expect(teamsInGames(games).sort()).toEqual(['BUF', 'CHI', 'GB', 'KC'])
  })
})

describe('FixtureLiveStatsProvider', () => {
  const provider = new FixtureLiveStatsProvider({
    games,
    playerStats: new Map([
      ['qb-kc', { pass_yds: 280, pass_td: 3 }],
      ['qb-gb', { pass_yds: 150, pass_td: 1 }],
    ]),
    teamDefenseStats: new Map([['nfl:def:KC', { def_sack: 3, def_int: 1 }]]),
  })

  it('returns its fixture games', async () => {
    expect(await provider.fetchActiveGames({ sport: 'NFL', season: 2026, week: 1 })).toHaveLength(2)
  })

  it('scopes player stats to the requested playerIds only', async () => {
    const out = await provider.fetchPlayerStatsForGames({ sport: 'NFL', season: 2026, week: 1, games, playerIds: ['qb-kc'] })
    expect([...out.keys()]).toEqual(['qb-kc'])
    expect(out.get('qb-kc')).toEqual({ pass_yds: 280, pass_td: 3 })
  })

  it('returns team-defense stats keyed by nfl:def id', async () => {
    const out = await provider.fetchTeamDefenseStatsForGames({ sport: 'NFL', season: 2026, week: 1, games })
    expect(out.get('nfl:def:KC')).toEqual({ def_sack: 3, def_int: 1 })
  })

  it('normalizeGameStatus reuses the canonical normalizer', () => {
    expect(provider.normalizeGameStatus('Final/OT')).toBe('final')
    expect(provider.normalizeGameStatus('HALFTIME')).toBe('halftime')
  })
})
