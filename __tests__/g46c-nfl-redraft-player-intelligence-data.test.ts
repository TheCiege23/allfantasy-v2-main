import { describe, expect, it } from 'vitest'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import {
  buildNflRedraftPlayerIntelligence,
  buildNflRedraftPlayerIntelligenceFromWire,
  normalizeNflRedraftProviderPlayerIntelligence,
  toCanonicalNflRedraftPlayerIntelligenceRecord,
  type NflRedraftPlayerIntelligence,
} from '@/lib/player-data/nflRedraftPlayerIntelligence'
import { adaptWaiverWirePlayer } from '@/lib/player-data/adapters/waiverPlayerAdapter'
import { mergeUnifiedIntoRosterState, type RosterStateMergeable } from '@/lib/player-data/adapters/rosterPlayerAdapter'
import { tradeEvidenceFromUnifiedWire } from '@/lib/player-data/adapters/tradePlayerContextAdapter'
import { matchupContextFromUnifiedWire } from '@/lib/player-data/adapters/matchupPlayerAdapter'
import { displayPlayerFromUnifiedRow } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import {
  getDraftRoomDisplayInjury,
  getDraftRoomDisplayIntelligence,
} from '@/lib/player-data/adapters/draftRoomDisplayFields'
import { mapNormalizedDraftEntryToPlayerEntry } from '@/lib/player-data/adapters/draftRoomPlayerAdapter'

const NOW = new Date('2026-07-03T12:00:00.000Z')

function intelligence(overrides: Partial<NflRedraftPlayerIntelligence> = {}): NflRedraftPlayerIntelligence {
  return {
    ...buildNflRedraftPlayerIntelligence({
      projectedFantasyPoints: 19.8,
      seasonProjectedPoints: 298.4,
      restOfSeasonProjectedPoints: 188.2,
      projectionFloor: 11.2,
      projectionCeiling: 28.6,
      scoringFormat: 'ppr',
      projectionSource: 'sportsdataio',
      projectionUpdatedAtIso: '2026-07-03T10:00:00.000Z',
      projectionFreshness: 'available',
      fantasyRank: 12,
      positionalRank: 4,
      adp: 17.3,
      adpSource: 'sleeper',
      aiAdp: 16.9,
      aiAdpSampleSize: 42,
      injuryStatus: 'Questionable',
      practiceStatus: 'Limited',
      gameStatus: 'Expected to play',
      injurySource: 'sportsdataio',
      injuryUpdatedAtIso: '2026-07-03T09:00:00.000Z',
      injuryFreshness: 'available',
      latestNews: 'Returned to limited practice.',
      newsTimestamp: '2026-07-03T08:30:00.000Z',
      newsSource: 'sportsdataio',
      newsFreshness: 'available',
      trendLabel: 'rising',
      providerFreshness: {
        status: 'available',
        updatedAtIso: '2026-07-03T10:00:00.000Z',
        ageMinutes: 120,
        maxAgeMinutes: 180,
        stale: false,
        warnings: [],
      },
      providerFallback: {
        fallback: false,
        fields: [],
        labels: [],
      },
    }),
    ...overrides,
  }
}

function wire(intel: NflRedraftPlayerIntelligence, partial: Partial<UnifiedPlayerWireDto> = {}): UnifiedPlayerWireDto {
  return {
    id: 'af-player-46c',
    name: 'Legacy Intelligence',
    position: 'RB',
    team: 'LAR',
    sport: 'NFL',
    headshotUrl: 'https://legacy.test/player.png',
    imageUrl: 'https://legacy.test/player.png',
    teamLogoUrl: 'https://legacy.test/lar.svg',
    injuryStatus: 'Legacy Healthy',
    fantasyPointsPerGame: 14.4,
    projectedPoints: 5.5,
    adp: 99,
    aiAdp: 101,
    aiAdpSampleSize: 2,
    collegeClass: 'unknown',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: null,
    nflRookieSource: null,
    lowConfidence: false,
    profileSource: 'legacy-profile',
    statsSource: 'legacy-stats',
    projectionsSource: 'legacy-projection',
    normalizedStats: {},
    normalizedProjections: {},
    nflRedraftPlayerIntelligence: intel,
    product: {
      unified: {
        adpSource: 'legacy-adp',
        aiAdpSource: 'legacy-ai-adp',
      } as UnifiedPlayerWireDto['product']['unified'],
      yearsExp: null,
      byeWeek: null,
    },
    ...partial,
  }
}

function unifiedView(): UnifiedPlayerProductView {
  return {
    playerId: 'af-player-serialize',
    name: 'Serialize Runner',
    position: 'WR',
    team: 'CIN',
    byeWeek: 10,
    display: {
      playerId: 'af-player-serialize',
      displayName: 'Serialize Runner',
      sport: 'NFL',
      assets: {
        headshotUrl: 'https://cdn.test/player.png',
        teamLogoUrl: 'https://cdn.test/cin.svg',
      },
      team: {
        teamId: 'cin',
        abbreviation: 'CIN',
        displayName: 'Cincinnati Bengals',
        sport: 'NFL',
        logoUrl: 'https://cdn.test/cin.svg',
      },
      stats: {
        adp: 20.4,
        fantasyPointsPerGame: 15.2,
      },
      metadata: {
        position: 'WR',
        teamAbbreviation: 'CIN',
        injuryStatus: 'Probable',
        practiceStatus: 'Full',
        gameStatus: 'Active',
      },
    },
    unified: {
      playerId: 'af-player-serialize',
      providerPlayerId: 'provider-hidden-id',
      sport: 'NFL',
      soccerLeague: null,
      fullName: 'Serialize Runner',
      firstName: 'Serialize',
      lastName: 'Runner',
      position: 'WR',
      positionCategory: 'skill',
      team: 'CIN',
      teamId: 'cin',
      teamAbbr: 'CIN',
      status: 'active',
      jerseyNumber: 1,
      headshotUrl: 'https://cdn.test/player.png',
      imageSource: 'sportsdataio',
      profileSource: 'sportsdataio',
      statsSource: 'sportsdataio',
      projectionsSource: 'sportsdataio',
      liveSource: null,
      rookieSource: null,
      adpSource: 'sleeper',
      aiAdpSource: 'allfantasy',
      height: null,
      weight: null,
      birthDateRaw: null,
      age: 26,
      college: 'LSU',
      collegeClassRaw: null,
      collegeClass: 'unknown',
      collegeClassBucket: 'unknown',
      isFreshman: false,
      isUnderclassman: false,
      isDraftEligible: false,
      draftYear: null,
      yearsExperience: 4,
      yearsExpSource: 'sportsdataio',
      adp: 20.4,
      aiAdp: 19.8,
      aiAdpSampleSize: 64,
      projectedPoints: 18.4,
      fantasyPointsPerGame: 15.2,
      normalizedStats: {
        injuryUpdatedAt: '2026-07-03T09:00:00.000Z',
        practiceStatus: 'Full',
        gameStatus: 'Active',
      },
      normalizedProjections: {
        seasonProjectedPoints: 301.5,
        restOfSeasonProjectedPoints: 199.1,
        floor: 12.5,
        ceiling: 30.2,
        rank: 14,
        positionalRank: 5,
        updatedAt: '2026-07-03T10:00:00.000Z',
        latestNews: 'Cleared for full practice.',
        newsUpdatedAt: '2026-07-03T08:00:00.000Z',
        trendLabel: 'steady',
      },
      liveStats: null,
      rawStatsReference: null,
      isDrafted: null,
      isOnRoster: null,
      isOnWaivers: null,
      isFreeAgent: null,
      isLocked: null,
      injuryStatus: 'Probable',
      nflRookie: null,
      soccerPositionGroup: null,
      experience: { status: 'veteran', rookie: false, proYears: 4, source: 'sportsdataio' },
      lowConfidence: false,
    },
  } as unknown as UnifiedPlayerProductView
}

describe('G46C NFL redraft player intelligence data', () => {
  it('normalizes provider projection, ranking, ADP, injury, and news fields without leaking raw payloads', () => {
    const normalized = normalizeNflRedraftProviderPlayerIntelligence(
      'sportsdataio',
      {
        PlayerID: 18890,
        ProjectedFantasyPoints: 23.7,
        SeasonProjectedPoints: 341.2,
        Floor: 14.1,
        Ceiling: 35.5,
        Rank: 6,
        PositionRank: 2,
        ADP: 8.4,
        InjuryStatus: 'Questionable',
        PracticeStatus: 'Limited',
        GameStatus: 'Game-time decision',
        Headline: 'Limited in Thursday practice.',
        PublishedAt: '2026-07-03T09:15:00.000Z',
        providerPayload: { private: true },
      },
      { now: NOW, fetchedAtIso: '2026-07-03T12:00:00.000Z', sourceUpdatedAtIso: '2026-07-03T10:00:00.000Z' },
    )

    expect(normalized).toMatchObject({
      modelVersion: 'nfl-redraft-player-intelligence-v1',
      projection: {
        projectedFantasyPoints: 23.7,
        seasonProjectedPoints: 341.2,
        projectionRange: { low: 14.1, high: 35.5 },
        source: 'sportsdataio',
        freshness: 'available',
      },
      ranking: {
        fantasyRank: 6,
        positionalRank: 2,
        adp: 8.4,
        adpSource: 'sportsdataio',
      },
      injury: {
        injuryStatus: 'Questionable',
        practiceStatus: 'Limited',
        gameStatus: 'Game-time decision',
        source: 'sportsdataio',
      },
      news: {
        latestNews: 'Limited in Thursday practice.',
        source: 'sportsdataio',
      },
    })
    expect(JSON.stringify(normalized)).not.toContain('PlayerID')
    expect(JSON.stringify(normalized)).not.toContain('providerPayload')
    expect(JSON.stringify(normalized)).not.toContain('private')
  })

  it('handles missing fields, stale records, and fallback provider records honestly', () => {
    const record = toCanonicalNflRedraftPlayerIntelligenceRecord({
      providerId: 'rolling_insights',
      providerRecordId: 'ri-1',
      payload: {
        player_id: 'ri-1',
        updated_at: '2026-07-01T08:00:00.000Z',
      },
      now: NOW,
      fetchedAtIso: '2026-07-03T12:00:00.000Z',
      sourceUpdatedAtIso: '2026-07-01T08:00:00.000Z',
      fallback: true,
      maxAgeMinutes: 120,
    })

    expect(record.freshness.status).toBe('stale')
    expect(record.fallback).toBe(true)
    expect(record.data.projection.unavailable).toBe(true)
    expect(record.data.injury.injuryStatus).toBeNull()
    expect(record.data.news.latestNews).toBeNull()
    expect(record.data.providerFreshness.stale).toBe(true)
    expect(record.data.providerFallback.fallback).toBe(true)
    expect(record.data.providerFallback.fields).toContain('projection')
    expect(record.data.providerFallback.fields).toContain('news')
  })

  it('serializes canonical player intelligence with no provider-specific IDs or payloads', () => {
    const row = serializeUnifiedPlayerForApi(unifiedView())
    const intel = row.nflRedraftPlayerIntelligence

    expect(intel).toMatchObject({
      projection: {
        projectedFantasyPoints: 18.4,
        seasonProjectedPoints: 301.5,
        projectionRange: { low: 12.5, high: 30.2 },
        source: 'sportsdataio',
      },
      ranking: {
        fantasyRank: 14,
        positionalRank: 5,
        adp: 20.4,
      },
      injury: {
        injuryStatus: 'Probable',
        practiceStatus: 'Full',
        gameStatus: 'Active',
      },
      news: {
        latestNews: 'Cleared for full practice.',
      },
      trendLabel: 'steady',
    })
    expect(JSON.stringify(intel)).not.toContain('provider-hidden-id')
    expect(JSON.stringify(intel)).not.toContain('providerIds')
    expect(JSON.stringify(intel)).not.toContain('providerPayload')
  })

  it('builds canonical intelligence from wire rows without deeper canonical data', () => {
    const built = buildNflRedraftPlayerIntelligenceFromWire(
      wire(intelligence(), {
        nflRedraftPlayerIntelligence: undefined,
        projectedPoints: 13.2,
        adp: 44.6,
        injuryStatus: null,
        normalizedProjections: {
          rank: 30,
          positionalRank: 11,
          latestNews: 'No new update.',
          updatedAt: '2026-07-03T07:00:00.000Z',
        },
      }),
    )

    expect(built).toMatchObject({
      projection: { projectedFantasyPoints: 13.2 },
      ranking: { fantasyRank: 30, positionalRank: 11, adp: 44.6 },
      injury: { injuryStatus: null, freshness: 'missing' },
      news: { latestNews: 'No new update.' },
    })
  })

  it('makes roster, waiver, trade, matchup, team display, and player-card adapters consume canonical intelligence first', () => {
    const intel = intelligence()
    const row = wire(intel)
    const waiver = adaptWaiverWirePlayer(row)
    const trade = tradeEvidenceFromUnifiedWire(row)
    const matchup = matchupContextFromUnifiedWire(row)
    const display = displayPlayerFromUnifiedRow(row)
    const rosterState: RosterStateMergeable = {
      starters: [{ id: row.id, name: 'Old', team: 'LAR', position: 'RB', opponent: '', gameTime: '', projection: 0, actual: null, status: 'healthy', slot: 'starters' }],
      bench: [],
      ir: [],
      taxi: [],
      devy: [],
    }
    const roster = mergeUnifiedIntoRosterState(rosterState, [row])

    expect(waiver.displayProjection).toBe(19.8)
    expect(waiver.displayAdp).toBe(17.3)
    expect(waiver.displayInjury).toBe('Questionable')
    expect(waiver.canonicalPlayerIntelligence).toBe(intel)
    expect(trade).toMatchObject({ projectedPoints: 19.8, injuryStatus: 'Questionable', adp: 17.3, canonicalPlayerIntelligence: intel })
    expect(matchup).toMatchObject({ projectedPoints: 19.8, injuryStatus: 'Questionable', projectionSource: 'sportsdataio', canonicalPlayerIntelligence: intel })
    expect(display).toMatchObject({ projectedPoints: 19.8, injuryStatus: 'Questionable', canonicalPlayerIntelligence: intel })
    expect(roster.starters[0]).toMatchObject({
      providerInjuryLabel: 'Questionable',
      unifiedProjectedPoints: 19.8,
      canonicalPlayerIntelligence: intel,
    })
  })

  it('wires canonical intelligence through draft room and mock draft player rows', () => {
    const entry = {
      playerId: 'player-46c',
      name: 'Draft Intelligence',
      position: 'WR',
      team: 'DAL',
      adp: 18.1,
      display: {
        playerId: 'player-46c',
        displayName: 'Draft Intelligence',
        sport: 'NFL',
        assets: {
          headshotUrl: 'https://draft.test/player.png',
          teamLogoUrl: 'https://draft.test/dal.svg',
        },
        team: {
          teamId: 'dal',
          abbreviation: 'DAL',
          displayName: 'Dallas Cowboys',
          sport: 'NFL',
          logoUrl: 'https://draft.test/dal.svg',
        },
        stats: { adp: 18.1 },
        metadata: {
          position: 'WR',
          teamAbbreviation: 'DAL',
          injuryStatus: 'Doubtful',
          practiceStatus: 'DNP',
        },
      },
      projectionSource: 'sportsdataio',
      nflDraftProjectionSplits: {
        projectedPointsPerGame: 15.1,
        projectedPoints: 255.5,
      },
    } as unknown as NormalizedDraftEntry

    const row = mapNormalizedDraftEntryToPlayerEntry(entry, {
      useAllFantasyAdp: true,
      aiAdpLookupMaps: { strict: new Map(), loose: new Map() },
    })

    expect(getDraftRoomDisplayIntelligence(row)?.projection.projectedFantasyPoints).toBe(15.1)
    expect(getDraftRoomDisplayIntelligence(row)?.ranking.adp).toBe(18.1)
    expect(getDraftRoomDisplayInjury(row)).toBe('Doubtful')
    expect(JSON.stringify(getDraftRoomDisplayIntelligence(row))).not.toContain('player-46c')
  })
})
