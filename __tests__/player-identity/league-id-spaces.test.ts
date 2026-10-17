// @vitest-environment node
/**
 * `leagueIdSpaces` — which half of a league's player ids is asked of which column.
 * Every reader that resolves roster / draft ids goes through this one rule.
 */
import { describe, expect, it } from 'vitest'
import { leagueIdSpaces } from '@/lib/player-identity/externalIdNamespace'

describe('leagueIdSpaces', () => {
  it('a Sleeper league: every id is a Sleeper id', () => {
    expect(leagueIdSpaces(['9228', 'BUF', '9228'], 'NFL', 'sleeper')).toEqual({ sleeperIds: ['9228', 'BUF'], providerIds: [] })
  })

  it('a native NFL league: a bare number is a Sleeper id; self-describing ids go to externalId', () => {
    expect(leagueIdSpaces(['9228', 'name:Josh Allen:QB:BUF', 'tsdb_1'], 'NFL', 'manual')).toEqual({
      sleeperIds: ['9228'],
      providerIds: ['name:Josh Allen:QB:BUF', 'tsdb_1'],
    })
  })

  it('a native NHL league: its numbers are Rolling Insights ids — Sleeper has no NHL', () => {
    expect(leagueIdSpaces(['1086'], 'NHL', 'manual')).toEqual({ sleeperIds: [], providerIds: ['1086'] })
  })

  it('a foreign platform: neither — its ids are its own', () => {
    for (const p of ['fleaflicker', 'mfl', 'fantrax', 'yahoo', 'espn']) {
      expect(leagueIdSpaces(['9228'], 'NFL', p)).toEqual({ sleeperIds: [], providerIds: [] })
    }
  })

  it('an ESPN roster already translated by sleeperReadableRosters is in Sleeper’s space', () => {
    expect(leagueIdSpaces(['421'], 'NFL', 'espn', { translated: true })).toEqual({ sleeperIds: ['421'], providerIds: [] })
  })
})
