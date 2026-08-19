import { describe, expect, it } from 'vitest'
import {
  buildAllFantasyPlayerId,
  getNflRedraftFallbackChain,
  normalizeNflFantasyPositions,
  normalizeNflHeadshotUrl,
  normalizeNflProviderPlayerIds,
  normalizeNflProviderPosition,
  normalizeNflProviderTeamAbbreviation,
  normalizeRollingInsightsPlayerIdentity,
  normalizeSleeperPlayerIdentity,
  normalizeSportsDataIoPlayerIdentity,
  normalizeTheSportsDbPlayerIdentity,
  toCanonicalNflRedraftPlayerIdentityRecord,
} from '@/lib/nfl-provider'

const now = new Date('2026-07-03T12:00:00.000Z')

describe('G46A NFL redraft provider identity mapping', () => {
  it('normalizes SportsDataIO player payloads into canonical AllFantasy identity', () => {
    const identity = normalizeSportsDataIoPlayerIdentity(
      {
        PlayerID: 18890,
        Name: 'Patrick Mahomes',
        FirstName: 'Patrick',
        LastName: 'Mahomes',
        Team: 'KC',
        TeamID: 16,
        Position: 'QB',
        FantasyPositions: ['QB'],
        Number: 15,
        PhotoUrl: 'https://cdn.example.test/mahomes.png',
        TeamLogoUrl: 'https://cdn.example.test/kc.svg',
        Height: '6-2',
        Weight: 225,
        Age: 30,
        Experience: 9,
        College: 'Texas Tech',
        ByeWeek: 10,
        Active: true,
        Updated: '2026-07-03T11:30:00.000Z',
      },
      { now, fetchedAtIso: '2026-07-03T12:00:00.000Z' },
    )

    expect(identity).toMatchObject({
      modelVersion: 'nfl-redraft-player-identity-v1',
      allFantasyPlayerId: 'af:nfl:sportsdataio:18890',
      playerName: 'Patrick Mahomes',
      preferredDisplayName: 'Patrick Mahomes',
      team: 'KC',
      position: 'QB',
      fantasyPositions: ['QB'],
      jerseyNumber: 15,
      headshotUrl: 'https://cdn.example.test/mahomes.png',
      teamLogoUrl: 'https://cdn.example.test/kc.svg',
      height: '6-2',
      weight: 225,
      age: 30,
      experience: 9,
      college: 'Texas Tech',
      byeWeek: 10,
      activeStatus: 'active',
      sourceProviderId: 'sportsdataio',
    })
    expect(identity.providerIds).toMatchObject({
      primaryProviderId: 'sportsdataio',
      providerPlayerId: '18890',
      sportsDataIoId: '18890',
    })
    expect(identity.providerTeamIds.sportsDataIoTeamId).toBe('16')
    expect(identity.cache.freshness).toMatchObject({ status: 'fresh', ageMinutes: 30 })
    expect(identity.cache.stale).toBe(false)
  })

  it('handles partial Sleeper responses without leaking provider payloads', () => {
    const identity = normalizeSleeperPlayerIdentity(
      {
        player_id: '4046',
        first_name: 'Christian',
        last_name: 'McCaffrey',
        team: 'SFO',
        position: 'RB',
        fantasy_positions: ['RB', 'FLEX'],
        number: '23',
        metadata: { image_url: '/not-a-url.jpg', privateProviderBlob: true },
        years_exp: 8,
        active: true,
      },
      { now, fetchedAtIso: '2026-07-03T12:00:00.000Z', lastSuccessfulSyncAtIso: '2026-07-03T11:50:00.000Z', fallback: true },
    )

    expect(identity.playerName).toBe('Christian McCaffrey')
    expect(identity.preferredDisplayName).toBe('Christian McCaffrey')
    expect(identity.team).toBe('SF')
    expect(identity.fantasyPositions).toEqual(['RB', 'FLEX'])
    expect(identity.headshotUrl).toBeNull()
    expect(identity.providerIds).toMatchObject({
      providerPlayerId: '4046',
      sleeperId: '4046',
    })
    expect(identity.cache).toMatchObject({
      fallback: true,
      stale: false,
    })
    expect(JSON.stringify(identity)).not.toContain('privateProviderBlob')
  })

  it('maps TheSportsDB names, IDs, full team names, and media fields', () => {
    const identity = normalizeTheSportsDbPlayerIdentity(
      {
        idPlayer: '341123',
        strPlayer: 'CeeDee Lamb',
        strTeam: 'Dallas Cowboys',
        idTeam: '134934',
        strPosition: 'Wide Receiver',
        strFantasyPositions: 'WR,FLEX',
        strNumber: '88',
        strCutout: 'https://www.thesportsdb.com/images/lamb.png',
        strTeamBadge: 'https://www.thesportsdb.com/images/dal.png',
        strHeight: '6 ft 2 in',
        strWeight: '200 lb',
        strCollege: 'Oklahoma',
        strStatus: 'Active',
        dateModified: '2026-07-03T10:00:00.000Z',
      },
      { now },
    )

    expect(identity.allFantasyPlayerId).toBe('af:nfl:thesportsdb:341123')
    expect(identity.team).toBe('DAL')
    expect(identity.position).toBe('WIDE RECEIVER')
    expect(identity.fantasyPositions).toEqual(['WR', 'FLEX'])
    expect(identity.providerIds.theSportsDbId).toBe('341123')
    expect(identity.providerTeamIds.theSportsDbTeamId).toBe('134934')
    expect(identity.weight).toBe(200)
    expect(identity.cache.freshness.status).toBe('fresh')
  })

  it('maps Rolling Insights IDs and marks stale cache data', () => {
    const identity = normalizeRollingInsightsPlayerIdentity(
      {
        player_id: 'ri-101',
        player: 'Justin Jefferson',
        team: 'MIN',
        team_id: 'ri-min',
        position: 'WR',
        number: 18,
        height: '6-1',
        weight: '195',
        college: 'LSU',
        status: 'active',
        updated_at: '2026-07-01T08:00:00.000Z',
      },
      { now, fetchedAtIso: '2026-07-03T12:00:00.000Z' },
    )

    expect(identity.providerIds).toMatchObject({
      primaryProviderId: 'rolling_insights',
      providerPlayerId: 'ri-101',
      rollingInsightsId: 'ri-101',
    })
    expect(identity.providerTeamIds.rollingInsightsTeamId).toBe('ri-min')
    expect(identity.cache.freshness).toMatchObject({ status: 'stale' })
    expect(identity.cache.stale).toBe(true)
    expect(identity.cache.warnings).toContain('Provider identity data is stale.')
  })

  it('creates canonical records with G45 freshness metadata', () => {
    const record = toCanonicalNflRedraftPlayerIdentityRecord({
      providerId: 'sportsdataio',
      payload: {
        PlayerID: 4314,
        Name: 'Derrick Henry',
        Team: 'BAL',
        Position: 'RB',
        FantasyPositions: 'RB,FLEX',
        Updated: '2026-07-03T11:00:00.000Z',
      },
      now,
      fetchedAtIso: '2026-07-03T12:00:00.000Z',
    })

    expect(record).toMatchObject({
      providerId: 'sportsdataio',
      providerRecordId: '4314',
      fetchedAtIso: '2026-07-03T12:00:00.000Z',
      sourceUpdatedAtIso: '2026-07-03T11:00:00.000Z',
      fallback: false,
    })
    expect(record.freshness).toMatchObject({ status: 'fresh', ageMinutes: 60 })
    expect(record.data.allFantasyPlayerId).toBe('af:nfl:sportsdataio:4314')
  })

  it('supports reusable ID, team, position, fantasy-position, and media utilities', () => {
    expect(buildAllFantasyPlayerId({ providerId: 'sleeper', providerPlayerId: '  abc  ' })).toBe('af:nfl:sleeper:abc')
    expect(buildAllFantasyPlayerId({ providerId: 'sleeper', providerPlayerId: null, playerName: 'Amon-Ra St. Brown', team: 'DET', position: 'WR' })).toBe(
      'af:nfl:name:amon-ra-st-brown:det:wr',
    )
    expect(normalizeNflProviderTeamAbbreviation('Washington Commanders')).toBe('WAS')
    expect(normalizeNflProviderTeamAbbreviation('JAC')).toBe('JAX')
    expect(normalizeNflProviderPosition('PK')).toBe('K')
    expect(normalizeNflFantasyPositions('RB', 'WR,TE,FLEX')).toEqual(['RB', 'WR', 'TE', 'FLEX'])
    expect(normalizeNflHeadshotUrl('not-a-url')).toBeNull()
    expect(normalizeNflHeadshotUrl('https://assets.example.test/player.jpg')).toBe('https://assets.example.test/player.jpg')
  })

  it('keeps provider identity extensible through the G45 provider foundation', () => {
    const ids = normalizeNflProviderPlayerIds({
      providerId: 'rolling_insights',
      payload: {
        player_id: 'ri-900',
        sleeperId: 'sleep-900',
        sportsDataIoId: 'sdio-900',
        theSportsDbId: 'tsdb-900',
      },
    })

    expect(ids).toMatchObject({
      allFantasyPlayerId: 'af:nfl:rolling_insights:ri-900',
      rollingInsightsId: 'ri-900',
      sleeperId: 'sleep-900',
      sportsDataIoId: 'sdio-900',
      theSportsDbId: 'tsdb-900',
    })
    expect(getNflRedraftFallbackChain('player_metadata', {} as NodeJS.ProcessEnv)).toEqual(['sleeper', 'deterministic'])
    expect(getNflRedraftFallbackChain('player_metadata', { ROLLING_INSIGHTS_API_KEY: 'configured' } as NodeJS.ProcessEnv)).toEqual([
      'rolling_insights',
      'sleeper',
      'deterministic',
    ])
  })
})
