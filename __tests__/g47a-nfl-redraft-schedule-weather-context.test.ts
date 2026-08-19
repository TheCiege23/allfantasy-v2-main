import { describe, expect, it } from 'vitest'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import {
  buildNflRedraftGameContext,
  buildNflRedraftGameContextFromWire,
  normalizeNflRedraftProviderGameContext,
  toCanonicalNflRedraftGameContextRecord,
  type NflRedraftGameContext,
} from '@/lib/player-data/nflRedraftGameContext'
import { adaptWaiverWirePlayer } from '@/lib/player-data/adapters/waiverPlayerAdapter'
import { mergeUnifiedIntoRosterState, type RosterStateMergeable } from '@/lib/player-data/adapters/rosterPlayerAdapter'
import { tradeEvidenceFromUnifiedWire } from '@/lib/player-data/adapters/tradePlayerContextAdapter'
import { matchupContextFromUnifiedWire } from '@/lib/player-data/adapters/matchupPlayerAdapter'
import { displayPlayerFromUnifiedRow } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import { getDraftRoomDisplayGameContext } from '@/lib/player-data/adapters/draftRoomDisplayFields'
import { mapNormalizedDraftEntryToPlayerEntry } from '@/lib/player-data/adapters/draftRoomPlayerAdapter'

const NOW = new Date('2026-07-03T12:00:00.000Z')

function context(overrides: Partial<NflRedraftGameContext> = {}): NflRedraftGameContext {
  return {
    ...buildNflRedraftGameContext({
      season: 2026,
      week: 3,
      playerTeamAbbr: 'KC',
      homeTeamAbbr: 'KC',
      awayTeamAbbr: 'LAC',
      kickoffTimeIso: '2026-09-20T20:25:00.000Z',
      stadiumName: 'GEHA Field at Arrowhead Stadium',
      stadiumCity: 'Kansas City',
      stadiumState: 'MO',
      roofType: 'outdoor',
      byeWeek: 10,
      gameStatus: 'Scheduled',
      weatherCondition: 'Light rain',
      temperatureF: 58,
      windSpeedMph: 14,
      precipitationType: 'rain',
      precipitationChancePercent: 35,
      weatherSource: 'openweather',
      weatherUpdatedAtIso: '2026-09-20T17:00:00.000Z',
      weatherFreshness: 'available',
      providerFreshness: {
        status: 'available',
        updatedAtIso: '2026-09-20T12:00:00.000Z',
        ageMinutes: 60,
        maxAgeMinutes: 1440,
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

function wire(gameContext: NflRedraftGameContext, partial: Partial<UnifiedPlayerWireDto> = {}): UnifiedPlayerWireDto {
  return {
    id: 'af-game-context-player',
    name: 'Schedule Runner',
    position: 'RB',
    team: 'KC',
    sport: 'NFL',
    headshotUrl: null,
    imageUrl: null,
    teamLogoUrl: null,
    injuryStatus: null,
    fantasyPointsPerGame: null,
    projectedPoints: null,
    adp: null,
    aiAdp: null,
    aiAdpSampleSize: null,
    collegeClass: 'unknown',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: null,
    nflRookieSource: null,
    lowConfidence: false,
    profileSource: 'sportsdataio',
    statsSource: 'sportsdataio',
    projectionsSource: null,
    normalizedStats: {
      opponent: 'LV',
      kickoffTimeIso: '2026-09-21T01:00:00.000Z',
      providerPayload: { private: true },
    },
    normalizedProjections: {},
    nflRedraftGameContext: gameContext,
    product: {
      unified: {} as UnifiedPlayerWireDto['product']['unified'],
      yearsExp: null,
      byeWeek: gameContext.byeWeek,
    },
    ...partial,
  }
}

function unifiedView(): UnifiedPlayerProductView {
  return {
    playerId: 'af-game-context-serialize',
    name: 'Serialize Schedule',
    position: 'WR',
    team: 'CIN',
    byeWeek: 12,
    display: {
      playerId: 'af-game-context-serialize',
      displayName: 'Serialize Schedule',
      sport: 'NFL',
      assets: {},
      team: {
        teamId: 'cin',
        abbreviation: 'CIN',
        displayName: 'Cincinnati Bengals',
        sport: 'NFL',
        logoUrl: null,
      },
      stats: {},
      metadata: {
        position: 'WR',
        teamAbbreviation: 'CIN',
        gameContext: {
          nflSeason: 2026,
          nflWeek: 4,
          homeTeam: 'CIN',
          awayTeam: 'BAL',
          kickoffTimeIso: '2026-09-27T17:00:00.000Z',
          stadium: 'Paycor Stadium',
          stadiumCity: 'Cincinnati',
          stadiumState: 'OH',
          roofType: 'outdoor',
          weatherCondition: 'Clear',
          temperatureF: 72,
          windSpeedMph: 6,
          precipitationType: 'none',
          weatherSource: 'openweather',
          weatherUpdatedAt: '2026-09-27T14:00:00.000Z',
          providerRawScheduleId: 'do-not-leak',
        },
      },
    },
    unified: {
      playerId: 'af-game-context-serialize',
      providerPlayerId: 'provider-hidden-id',
      sport: 'NFL',
      fullName: 'Serialize Schedule',
      position: 'WR',
      team: 'CIN',
      teamAbbr: 'CIN',
      normalizedStats: {},
      normalizedProjections: {},
      injuryStatus: null,
      projectedPoints: null,
      adp: null,
      aiAdp: null,
      aiAdpSampleSize: null,
      lowConfidence: false,
    },
  } as unknown as UnifiedPlayerProductView
}

describe('G47A NFL redraft schedule, stadium, and weather context', () => {
  it('normalizes provider schedule, opponent, home/away, kickoff, stadium, and weather without payload leakage', () => {
    const normalized = normalizeNflRedraftProviderGameContext(
      'sportsdataio',
      {
        GameID: 991,
        Season: 2026,
        Week: 3,
        HomeTeam: 'KC',
        AwayTeam: 'LAC',
        DateTime: '2026-09-20T20:25:00.000Z',
        StadiumDetails: {
          Name: 'GEHA Field at Arrowhead Stadium',
          City: 'Kansas City',
          State: 'MO',
          Type: 'Outdoor',
        },
        ForecastDescription: 'Light rain',
        TemperatureF: 58,
        WindSpeedMph: 14,
        PrecipitationChancePercent: 35,
        Updated: '2026-09-20T12:00:00.000Z',
        providerPayload: { private: true },
      },
      { now: NOW, playerTeamAbbr: 'KC' },
    )

    expect(normalized).toMatchObject({
      modelVersion: 'nfl-redraft-game-context-v1',
      season: 2026,
      week: 3,
      opponent: { teamAbbr: 'LAC' },
      homeAway: 'home',
      kickoffTimeIso: '2026-09-20T20:25:00.000Z',
      gameDateIso: '2026-09-20',
      stadium: {
        name: 'GEHA Field at Arrowhead Stadium',
        city: 'Kansas City',
        state: 'MO',
        roofType: 'outdoor',
      },
      weather: {
        condition: 'Light rain',
        temperatureF: 58,
        windSpeedMph: 14,
        precipitationType: 'rain',
        precipitationChancePercent: 35,
      },
    })
    expect(JSON.stringify(normalized)).not.toContain('GameID')
    expect(JSON.stringify(normalized)).not.toContain('providerPayload')
    expect(JSON.stringify(normalized)).not.toContain('private')
  })

  it('marks stale weather, missing schedule fields, and fallback provider records honestly', () => {
    const record = toCanonicalNflRedraftGameContextRecord({
      providerId: 'openweather',
      providerRecordId: 'weather-kc',
      payload: {
        weather: [{ main: 'Snow' }],
        main: { temp: 31 },
        wind: { speed: 18 },
        updatedAt: '2026-07-03T08:00:00.000Z',
      },
      now: NOW,
      sourceUpdatedAtIso: '2026-07-03T08:00:00.000Z',
      fallback: true,
      maxAgeMinutes: 120,
      playerTeamAbbr: 'KC',
    })

    expect(record.freshness.status).toBe('stale')
    expect(record.fallback).toBe(true)
    expect(record.data.providerFreshness.stale).toBe(true)
    expect(record.data.weatherFreshness.stale).toBe(true)
    expect(record.data.providerFallback.fallback).toBe(true)
    expect(record.data.providerFallback.fields).toContain('opponent')
    expect(record.data.providerFallback.fields).toContain('kickoffTime')
    expect(record.data.providerFallback.fields).toContain('gameContext')
    expect(record.data.weather.condition).toBe('Snow')
  })

  it('handles bye weeks without inventing opponents, kickoff times, stadiums, or weather', () => {
    const bye = buildNflRedraftGameContext({
      season: 2026,
      week: 10,
      byeWeek: 10,
      providerFreshness: { status: 'available' },
    })

    expect(bye.isByeWeek).toBe(true)
    expect(bye.opponent.teamAbbr).toBeNull()
    expect(bye.kickoffTimeIso).toBeNull()
    expect(bye.stadium.name).toBeNull()
    expect(bye.gameStatus).toBe('Bye')
    expect(bye.weather.unavailable).toBe(true)
    expect(bye.providerFallback.fields).not.toContain('opponent')
    expect(bye.providerFallback.fields).not.toContain('weather')
  })

  it('serializes canonical game context from unified player rows without provider-specific IDs', () => {
    const row = serializeUnifiedPlayerForApi(unifiedView())
    const game = row.nflRedraftGameContext

    expect(game).toMatchObject({
      season: 2026,
      week: 4,
      opponent: { teamAbbr: 'BAL' },
      homeAway: 'home',
      kickoffTimeIso: '2026-09-27T17:00:00.000Z',
      gameDateIso: '2026-09-27',
      stadium: {
        name: 'Paycor Stadium',
        city: 'Cincinnati',
        state: 'OH',
        roofType: 'outdoor',
      },
      weather: {
        condition: 'Clear',
        temperatureF: 72,
        windSpeedMph: 6,
        precipitationType: 'none',
      },
    })
    expect(JSON.stringify(game)).not.toContain('provider-hidden-id')
    expect(JSON.stringify(game)).not.toContain('providerRawScheduleId')
  })

  it('makes roster, waiver, trade, matchup, team display, and player-card adapters consume canonical game context first', () => {
    const game = context()
    const row = wire(game)
    const waiver = adaptWaiverWirePlayer(row)
    const trade = tradeEvidenceFromUnifiedWire(row)
    const matchup = matchupContextFromUnifiedWire(row)
    const display = displayPlayerFromUnifiedRow(row)
    const rosterState: RosterStateMergeable = {
      starters: [{ id: row.id, name: 'Old', team: 'KC', position: 'RB', opponent: 'LV', gameTime: 'legacy', projection: 0, actual: null, status: 'healthy', slot: 'starters' }],
      bench: [],
      ir: [],
      taxi: [],
      devy: [],
    }
    const roster = mergeUnifiedIntoRosterState(rosterState, [row])

    expect(waiver).toMatchObject({ displayOpponent: 'LAC', displayKickoffTime: '2026-09-20T20:25:00.000Z', canonicalGameContext: game })
    expect(trade).toMatchObject({ opponent: 'LAC', homeAway: 'home', kickoffTimeIso: '2026-09-20T20:25:00.000Z', weatherSummary: '58F / 14 mph wind / rain', canonicalGameContext: game })
    expect(matchup).toMatchObject({ opponent: 'LAC', gameStatus: 'Scheduled', weatherSummary: '58F / 14 mph wind / rain', canonicalGameContext: game })
    expect(display).toMatchObject({ opponent: 'LAC', homeAway: 'home', gameStatus: 'Scheduled', weatherSummary: '58F / 14 mph wind / rain', canonicalGameContext: game })
    expect(roster.starters[0]).toMatchObject({
      opponent: 'LAC',
      gameTime: '2026-09-20T20:25:00.000Z',
      providerGameStatus: 'Scheduled',
      providerWeatherSummary: '58F / 14 mph wind / rain',
      canonicalGameContext: game,
    })
  })

  it('wires canonical game context through draft room and mock draft player rows', () => {
    const entry = {
      playerId: 'player-g47a',
      name: 'Draft Schedule',
      position: 'QB',
      team: 'BUF',
      byeWeek: 7,
      display: {
        playerId: 'player-g47a',
        displayName: 'Draft Schedule',
        sport: 'NFL',
        assets: {},
        team: {
          teamId: 'buf',
          abbreviation: 'BUF',
          displayName: 'Buffalo Bills',
          sport: 'NFL',
          logoUrl: null,
        },
        stats: {},
        metadata: {
          position: 'QB',
          teamAbbreviation: 'BUF',
          gameContext: {
            nflSeason: 2026,
            nflWeek: 2,
            homeTeam: 'MIA',
            awayTeam: 'BUF',
            kickoffTimeIso: '2026-09-13T17:00:00.000Z',
            stadium: 'Hard Rock Stadium',
            stadiumCity: 'Miami Gardens',
            stadiumState: 'FL',
            roofType: 'outdoor',
            weatherCondition: 'Humid',
            temperatureF: 86,
            windSpeedMph: 9,
            precipitationType: 'none',
          },
        },
      },
    } as unknown as NormalizedDraftEntry

    const row = mapNormalizedDraftEntryToPlayerEntry(entry, {
      useAllFantasyAdp: true,
      aiAdpLookupMaps: { strict: new Map(), loose: new Map() },
    })

    expect(getDraftRoomDisplayGameContext(row)).toMatchObject({
      season: 2026,
      week: 2,
      opponent: { teamAbbr: 'MIA' },
      homeAway: 'away',
      kickoffTimeIso: '2026-09-13T17:00:00.000Z',
      weather: { temperatureF: 86, windSpeedMph: 9 },
    })
  })

  it('builds context from wire rows when only normalized cache fields are present', () => {
    const built = buildNflRedraftGameContextFromWire(
      wire(context(), {
        nflRedraftGameContext: undefined,
        normalizedStats: {
          nflSeason: 2026,
          nflWeek: 8,
          opponent: 'DEN',
          homeAway: 'away',
          kickoffTimeIso: '2026-10-25T20:05:00.000Z',
          stadium: 'Empower Field at Mile High',
          stadiumCity: 'Denver',
          stadiumState: 'CO',
          roofType: 'outdoor',
          weatherCondition: 'Snow showers',
          temperatureF: 29,
          windSpeedMph: 17,
          precipitationType: 'snow',
        },
      }),
    )

    expect(built).toMatchObject({
      season: 2026,
      week: 8,
      opponent: { teamAbbr: 'DEN' },
      homeAway: 'away',
      gameDateIso: '2026-10-25',
      stadium: { city: 'Denver', state: 'CO', roofType: 'outdoor' },
      weather: { condition: 'Snow showers', precipitationType: 'snow' },
    })
  })
})
