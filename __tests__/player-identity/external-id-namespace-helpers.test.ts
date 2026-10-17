import { describe, expect, it } from 'vitest'
import { indexBySleeperId, leagueIdentityColumns, ourIdOrSleeperIdWhere, playerRowKeys } from '@/lib/player-identity/externalIdNamespace'

describe('ourIdOrSleeperIdWhere', () => {
  it('matches our row id, the sleeperId column, and Sleeper’s own sleeper:<id> spelling — never a bare externalId', () => {
    expect(ourIdOrSleeperIdWhere(['9228', 'u-1', '9228'], 'nfl')).toEqual({
      sport: 'NFL',
      OR: [
        { id: { in: ['9228', 'u-1'] } },
        { sleeperId: { in: ['9228', 'u-1'] } },
        { externalId: { in: ['sleeper:9228', 'sleeper:u-1'] } },
      ],
    })
  })
})

describe('playerRowKeys', () => {
  it('keys a row by id and sleeperId only — an RI externalId is somebody else’s number', () => {
    expect(playerRowKeys({ id: 'u-mt', sleeperId: null })).toEqual(['u-mt'])
    expect(playerRowKeys({ id: 'u-by', sleeperId: '9228' })).toEqual(['u-by', '9228'])
  })
})

describe('indexBySleeperId', () => {
  it('one row per Sleeper id, Sleeper’s own row winning; rows without one are skipped', () => {
    const rows = [
      { sleeperId: '9228', source: 'rolling_insights', name: 'Bryce Young', position: 'Quarterback' },
      { sleeperId: '9228', source: 'sleeper', name: 'Bryce Young', position: 'QB' },
      { sleeperId: '9228', source: 'thesportsdb', name: 'Bryce Young', position: 'Quarterback' },
      { sleeperId: null, source: 'rolling_insights', name: 'Michael Tarquin', position: 'OT' },
    ]
    const idx = indexBySleeperId(rows)
    expect([...idx.keys()]).toEqual(['9228'])
    expect(idx.get('9228')).toMatchObject({ source: 'sleeper', position: 'QB' })
  })
})

describe('leagueIdentityColumns', () => {
  it('gives each platform ONE identity column, never the list against several', () => {
    expect(leagueIdentityColumns(['9228'], 'NFL', 'sleeper')).toEqual([{ column: 'sleeperId', ids: ['9228'] }])
    expect(leagueIdentityColumns(['4262921'], 'NFL', 'ESPN')).toEqual([{ column: 'espnId', ids: ['4262921'] }])
    expect(leagueIdentityColumns(['9001'], 'NFL', 'mfl')).toEqual([{ column: 'mflId', ids: ['9001'] }])
    expect(leagueIdentityColumns(['12'], 'NFL', 'fleaflicker')).toEqual([{ column: 'fleaflickerId', ids: ['12'] }])
    expect(leagueIdentityColumns(['12'], 'NFL', 'fantrax')).toEqual([{ column: 'fantraxId', ids: ['12'] }])
  })

  it('splits a native (or league-less) list: NFL numbers are Sleeper ids, other sports’ numbers RI ids, tokens nobody', () => {
    expect(leagueIdentityColumns(['9228', 'name:Josh Allen:QB:BUF'], 'NFL', 'native')).toEqual([{ column: 'sleeperId', ids: ['9228'] }])
    expect(leagueIdentityColumns(['4017', 'tsdb_1'], 'NHL', undefined)).toEqual([{ column: 'rollingInsightsId', ids: ['4017'] }])
  })

  it('names nobody for a platform with no column of its own', () => {
    expect(leagueIdentityColumns(['461.p.1'], 'NFL', 'yahoo')).toEqual([])
    expect(leagueIdentityColumns(['1'], 'NFL', 'some-new-host')).toEqual([])
  })
})
