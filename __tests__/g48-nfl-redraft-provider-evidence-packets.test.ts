import { describe, expect, it } from 'vitest'
import {
  NFL_REDRAFT_RATE_LIMITS,
  normalizeNflRedraftProviderError,
  normalizeSportsDataIoPlayerIdentity,
} from '@/lib/nfl-provider'
import { buildNflRedraftPlayerMetadataFromIdentity } from '@/lib/player-data/nflRedraftPlayerMetadata'
import { buildNflRedraftPlayerIntelligence } from '@/lib/player-data/nflRedraftPlayerIntelligence'
import { buildNflRedraftGameContext } from '@/lib/player-data/nflRedraftGameContext'
import { buildNflRedraftLiveScoringContext } from '@/lib/player-data/nflRedraftLiveScoringContext'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import {
  buildFantasyScoringEvidencePacket,
  buildInjuryEvidencePacket,
  buildLiveStatsEvidencePacket,
  buildNewsEvidencePacket,
  buildNflRedraftProviderEvidencePacketsFromCanonical,
  buildNflRedraftProviderEvidencePacketsFromWire,
  buildPlayerIdentityEvidencePacket,
  buildPlayerMetadataMediaEvidencePacket,
  buildProjectionEvidencePacket,
  buildRankingAdpEvidencePacket,
  buildScheduleGameEvidencePacket,
  buildStatCorrectionEvidencePacket,
  buildSurfaceContextEvidencePacket,
  buildWeatherEvidencePacket,
  type NflRedraftProviderEvidencePacket,
} from '@/lib/player-data/nflRedraftProviderEvidencePackets'

const NOW = new Date('2026-09-13T18:15:00.000Z')
const INGESTED = '2026-09-13T18:16:00.000Z'

const identity = normalizeSportsDataIoPlayerIdentity(
  {
    PlayerID: 42,
    Name: 'Evidence Runner',
    DisplayName: 'E. Runner',
    Team: 'KC',
    Position: 'RB',
    FantasyPositions: ['RB', 'FLEX'],
    Number: 25,
    PhotoUrl: 'https://cdn.example.test/player.png',
    TeamLogoUrl: 'https://cdn.example.test/kc.png',
    ByeWeek: 10,
    Status: 'Active',
    Updated: '2026-09-13T17:55:00.000Z',
    providerPayload: { secret: 'do-not-leak' },
  },
  { now: NOW, fetchedAtIso: INGESTED },
)

const metadata = buildNflRedraftPlayerMetadataFromIdentity(identity)

const intelligence = buildNflRedraftPlayerIntelligence({
  projectedFantasyPoints: 18.4,
  seasonProjectedPoints: 255.2,
  restOfSeasonProjectedPoints: 220.1,
  projectionFloor: 11.2,
  projectionCeiling: 25.7,
  scoringFormat: 'half_ppr',
  projectionSource: 'sportsdataio',
  projectionUpdatedAtIso: '2026-09-13T17:58:00.000Z',
  projectionFreshness: 'available',
  fantasyRank: 14,
  positionalRank: 6,
  adp: 19.5,
  adpSource: 'sleeper',
  aiAdp: 18.9,
  aiAdpSampleSize: 120,
  injuryStatus: 'Questionable',
  practiceStatus: 'Limited',
  gameStatus: 'Expected to play',
  injurySource: 'sportsdataio',
  injuryUpdatedAtIso: '2026-09-13T16:30:00.000Z',
  injuryFreshness: 'available',
  latestNews: 'Returned to limited practice.',
  newsTimestamp: '2026-09-13T16:35:00.000Z',
  newsSource: 'sportsdataio',
  newsFreshness: 'available',
  providerFreshness: {
    status: 'available',
    updatedAtIso: '2026-09-13T17:58:00.000Z',
    stale: false,
    warnings: [],
  },
  providerFallback: { fallback: false, fields: [], labels: [] },
})

const gameContext = buildNflRedraftGameContext({
  season: 2026,
  week: 1,
  playerTeamAbbr: 'KC',
  homeTeamAbbr: 'KC',
  awayTeamAbbr: 'LAC',
  kickoffTimeIso: '2026-09-13T20:25:00.000Z',
  stadiumName: 'GEHA Field at Arrowhead Stadium',
  stadiumCity: 'Kansas City',
  stadiumState: 'MO',
  roofType: 'outdoor',
  byeWeek: 10,
  gameStatus: 'Scheduled',
  weatherCondition: 'Clear',
  temperatureF: 71,
  windSpeedMph: 9,
  precipitationType: 'none',
  weatherSource: 'openweather',
  weatherUpdatedAtIso: '2026-09-13T17:50:00.000Z',
  weatherFreshness: 'available',
  providerFreshness: {
    status: 'available',
    updatedAtIso: '2026-09-13T17:50:00.000Z',
    ageMinutes: 25,
    maxAgeMinutes: 120,
    stale: false,
    warnings: [],
  },
  providerFallback: { fallback: false, fields: [], labels: [] },
})

const live = buildNflRedraftLiveScoringContext({
  playerId: identity.allFantasyPlayerId,
  gameId: 'nfl-game-1',
  season: 2026,
  week: 1,
  gameStatus: 'live',
  quarter: 3,
  clock: '07:12',
  stats: { rush_yds: 80, rush_td: 1, rec: 2, rec_yds: 10 },
  statsSource: 'sportsdataio',
  statsUpdatedAtIso: '2026-09-13T18:10:00.000Z',
  fantasyPoints: 16,
  projectedFantasyPoints: 18.4,
  actualFantasyPoints: 16,
  statCorrections: [
    {
      correctionId: 'corr-rush-yds-1',
      playerId: identity.allFantasyPlayerId,
      gameId: 'nfl-game-1',
      statCategory: 'rush_yds',
      oldValue: 78,
      newValue: 80,
      fantasyPointDelta: 0.2,
      providerSource: 'sportsdataio',
      timestampIso: '2026-09-13T18:12:00.000Z',
      applied: true,
    },
  ],
  scoringRefreshTimestamp: '2026-09-13T18:10:00.000Z',
  matchupRefreshTimestamp: '2026-09-13T18:10:00.000Z',
  providerFreshness: {
    status: 'available',
    updatedAtIso: '2026-09-13T18:10:00.000Z',
    ageMinutes: 5,
    maxAgeMinutes: 5,
    stale: false,
    warnings: [],
  },
})

function expectNoRawPayloadOrReasoning(packet: NflRedraftProviderEvidencePacket) {
  const json = JSON.stringify(packet).toLowerCase()
  expect(json).not.toContain('providerpayload')
  expect(json).not.toContain('rawproviderpayload')
  expect(json).not.toContain('do-not-leak')
  expect(json).not.toContain('secret')
  const forbiddenKeys = ['conclusion', 'recommendation', 'reasoning', 'llmsummary']
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      expect(forbiddenKeys).not.toContain(key.toLowerCase())
      visit(entry)
    }
  }
  visit(packet)
}

describe('G48 NFL redraft provider evidence packets', () => {
  it('creates deterministic player identity and media evidence packets without provider payload leakage', () => {
    const player = buildPlayerIdentityEvidencePacket(identity, {
      leagueId: 'league-g48',
      ingestedAtIso: INGESTED,
    })
    const repeat = buildPlayerIdentityEvidencePacket(identity, {
      leagueId: 'league-g48',
      ingestedAtIso: INGESTED,
    })
    const media = buildPlayerMetadataMediaEvidencePacket(metadata, {
      leagueId: 'league-g48',
      playerId: identity.allFantasyPlayerId,
      sourceProvider: identity.sourceProviderId,
      ingestedAtIso: INGESTED,
    })

    expect(player).toMatchObject({
      evidenceType: 'player_identity',
      canonicalLeagueId: 'league-g48',
      canonicalPlayerId: identity.allFantasyPlayerId,
      sourceProvider: 'sportsdataio',
      providerCapabilityDomain: 'player_metadata',
      freshnessStatus: 'available',
      confidenceLevel: 'high',
    })
    expect(player.evidenceId).toBe(repeat.evidenceId)
    expect(media).toMatchObject({
      evidenceType: 'player_metadata_media',
      providerCapabilityDomain: 'headshot',
      facts: {
        displayName: 'E. Runner',
        headshot: expect.objectContaining({ safeToRenderImage: true }),
      },
    })
    expectNoRawPayloadOrReasoning(player)
    expectNoRawPayloadOrReasoning(media)
  })

  it('creates projection, injury, news, and ranking/ADP packets from canonical intelligence', () => {
    const projection = buildProjectionEvidencePacket(intelligence.projection, {
      leagueId: 'league-g48',
      playerId: identity.allFantasyPlayerId,
      ingestedAtIso: INGESTED,
    })
    const injury = buildInjuryEvidencePacket(intelligence.injury, {
      leagueId: 'league-g48',
      playerId: identity.allFantasyPlayerId,
      ingestedAtIso: INGESTED,
    })
    const news = buildNewsEvidencePacket(intelligence.news, {
      leagueId: 'league-g48',
      playerId: identity.allFantasyPlayerId,
      ingestedAtIso: INGESTED,
    })
    const ranking = buildRankingAdpEvidencePacket(intelligence.ranking, {
      leagueId: 'league-g48',
      playerId: identity.allFantasyPlayerId,
      ingestedAtIso: INGESTED,
    })

    expect(projection).toMatchObject({
      evidenceType: 'projection',
      providerCapabilityDomain: 'projection',
      sourceProvider: 'sportsdataio',
      facts: { projectedFantasyPoints: 18.4, scoringFormat: 'half_ppr' },
    })
    expect(injury).toMatchObject({
      evidenceType: 'injury',
      providerCapabilityDomain: 'injury',
      facts: { injuryStatus: 'Questionable', practiceStatus: 'Limited' },
    })
    expect(news).toMatchObject({
      evidenceType: 'news',
      providerCapabilityDomain: 'news',
      facts: { latestNews: 'Returned to limited practice.' },
    })
    expect(ranking).toMatchObject({
      evidenceType: 'ranking_adp',
      providerCapabilityDomain: 'mock_draft',
      sourceProvider: 'sleeper',
      facts: { fantasyRank: 14, positionalRank: 6, adp: 19.5, aiAdp: 18.9 },
    })
    for (const packet of [projection, injury, news, ranking]) expectNoRawPayloadOrReasoning(packet)
  })

  it('creates schedule, weather, live scoring, fantasy scoring, and stat correction packets', () => {
    const schedule = buildScheduleGameEvidencePacket(gameContext, {
      leagueId: 'league-g48',
      playerId: identity.allFantasyPlayerId,
      gameId: 'nfl-game-1',
      ingestedAtIso: INGESTED,
    })
    const weather = buildWeatherEvidencePacket(gameContext, {
      leagueId: 'league-g48',
      playerId: identity.allFantasyPlayerId,
      gameId: 'nfl-game-1',
      ingestedAtIso: INGESTED,
    })
    const liveStats = buildLiveStatsEvidencePacket(live, {
      leagueId: 'league-g48',
      ingestedAtIso: INGESTED,
    })
    const scoring = buildFantasyScoringEvidencePacket(live, {
      leagueId: 'league-g48',
      matchupId: 'matchup-1',
      ingestedAtIso: INGESTED,
    })
    const correction = buildStatCorrectionEvidencePacket(live.statCorrections[0]!, {
      leagueId: 'league-g48',
      matchupId: 'matchup-1',
      ingestedAtIso: INGESTED,
    })

    expect(schedule).toMatchObject({
      evidenceType: 'schedule_game_context',
      providerCapabilityDomain: 'schedule',
      facts: { opponent: { teamAbbr: 'LAC' }, homeAway: 'home' },
    })
    expect(weather).toMatchObject({
      evidenceType: 'weather',
      providerCapabilityDomain: 'weather',
      sourceProvider: 'openweather',
      facts: { weather: expect.objectContaining({ temperatureF: 71, precipitationType: 'none' }) },
    })
    expect(liveStats).toMatchObject({
      evidenceType: 'live_stats',
      providerCapabilityDomain: 'live_score',
      sourceProvider: 'sportsdataio',
      facts: { gameStatus: 'live', stats: { rush_yds: 80, rush_td: 1, rec: 2, rec_yds: 10 } },
    })
    expect(scoring).toMatchObject({
      evidenceType: 'fantasy_scoring',
      canonicalMatchupId: 'matchup-1',
      facts: { fantasyPoints: 16, projectedFantasyPoints: 18.4, actualFantasyPoints: 16 },
    })
    expect(correction).toMatchObject({
      evidenceType: 'stat_correction',
      canonicalGameId: 'nfl-game-1',
      facts: { correctionId: 'corr-rush-yds-1', statCategory: 'rush_yds', applied: true },
    })
    for (const packet of [schedule, weather, liveStats, scoring, correction]) expectNoRawPayloadOrReasoning(packet)
  })

  it('creates roster, matchup, waiver, trade, and draft context packets where canonical data exists', () => {
    const contexts = [
      buildSurfaceContextEvidencePacket({
        evidenceType: 'roster_context',
        leagueId: 'league-g48',
        teamId: 'roster-1',
        playerId: identity.allFantasyPlayerId,
        ingestedAtIso: INGESTED,
        facts: { slotType: 'RB', starter: true, canonicalLivePoints: 16 },
      }),
      buildSurfaceContextEvidencePacket({
        evidenceType: 'matchup_context',
        leagueId: 'league-g48',
        matchupId: 'matchup-1',
        playerId: identity.allFantasyPlayerId,
        gameId: 'nfl-game-1',
        ingestedAtIso: INGESTED,
        facts: { matchupId: 'matchup-1', homeAway: 'home', liveGameStatus: 'live' },
      }),
      buildSurfaceContextEvidencePacket({
        evidenceType: 'waiver_context',
        leagueId: 'league-g48',
        playerId: identity.allFantasyPlayerId,
        ingestedAtIso: INGESTED,
        facts: { waiverEligible: true, displayProjection: 18.4 },
      }),
      buildSurfaceContextEvidencePacket({
        evidenceType: 'trade_context',
        leagueId: 'league-g48',
        playerId: identity.allFantasyPlayerId,
        ingestedAtIso: INGESTED,
        facts: { projectedPoints: 18.4, injuryStatus: 'Questionable' },
      }),
      buildSurfaceContextEvidencePacket({
        evidenceType: 'draft_context',
        leagueId: 'league-g48',
        playerId: identity.allFantasyPlayerId,
        ingestedAtIso: INGESTED,
        facts: { adp: 19.5, byeWeek: 10 },
      }),
    ]

    expect(contexts.map((packet) => packet.evidenceType)).toEqual([
      'roster_context',
      'matchup_context',
      'waiver_context',
      'trade_context',
      'draft_context',
    ])
    expect(contexts[0]!.affectedSurfaces).toEqual(expect.arrayContaining(['roster', 'team', 'player_card']))
    expect(contexts[1]!.affectedSurfaces).toEqual(expect.arrayContaining(['matchup']))
    expect(contexts[4]!.providerCapabilityDomain).toBe('mock_draft')
    for (const packet of contexts) expectNoRawPayloadOrReasoning(packet)
  })

  it('represents stale, fallback, missing, error, and rate-limit evidence without recommendations', () => {
    const staleProjection = buildProjectionEvidencePacket(
      {
        ...intelligence.projection,
        projectedFantasyPoints: null,
        seasonProjectedPoints: null,
        restOfSeasonProjectedPoints: null,
        freshness: 'stale',
        unavailable: true,
      },
      {
        leagueId: 'league-g48',
        playerId: identity.allFantasyPlayerId,
        ingestedAtIso: INGESTED,
      },
    )
    const error = normalizeNflRedraftProviderError({
      providerId: 'sportsdataio',
      error: new Error('rate limited'),
      status: 429,
    })
    const errored = buildSurfaceContextEvidencePacket({
      evidenceType: 'matchup_context',
      leagueId: 'league-g48',
      playerId: identity.allFantasyPlayerId,
      sourceProvider: 'sportsdataio',
      providerDomain: 'live_score',
      ingestedAtIso: INGESTED,
      error,
      rateLimit: NFL_REDRAFT_RATE_LIMITS.sportsdataio,
      facts: { matchupId: 'matchup-1' },
      freshness: { status: 'missing', warnings: ['Provider request failed.'] },
      fallback: { fallback: true, fields: ['matchupContext'], labels: ['Using fallback matchup context.'] },
    })

    expect(staleProjection).toMatchObject({
      stale: true,
      fallback: true,
      confidenceLevel: 'low',
      facts: { unavailable: true },
    })
    expect(errored).toMatchObject({
      missing: true,
      fallback: true,
      confidenceLevel: 'low',
      errorMetadata: { code: 'rate_limited', retryable: true },
      retryRateLimitMetadata: { maxRequestsPerMinute: 60, burst: 10, retryBackoffMs: 30000 },
    })
    expectNoRawPayloadOrReasoning(staleProjection)
    expectNoRawPayloadOrReasoning(errored)
  })

  it('builds packet sets from canonical objects and wire rows without leaking raw provider fields', () => {
    const canonicalPackets = buildNflRedraftProviderEvidencePacketsFromCanonical({
      leagueId: 'league-g48',
      teamId: 'KC',
      matchupId: 'matchup-1',
      identity,
      metadata,
      intelligence,
      gameContext,
      liveScoringContext: live,
      ingestedAtIso: INGESTED,
    })
    const wire: UnifiedPlayerWireDto = {
      id: identity.allFantasyPlayerId,
      name: identity.preferredDisplayName,
      position: identity.position,
      team: identity.team,
      sport: 'NFL',
      headshotUrl: metadata.headshot.url,
      imageUrl: metadata.headshot.url,
      teamLogoUrl: metadata.teamLogo.url,
      injuryStatus: intelligence.injury.injuryStatus,
      fantasyPointsPerGame: null,
      projectedPoints: intelligence.projection.projectedFantasyPoints,
      adp: intelligence.ranking.adp,
      aiAdp: intelligence.ranking.aiAdp,
      aiAdpSampleSize: intelligence.ranking.aiAdpSampleSize,
      collegeClass: 'unknown',
      collegeClassLabel: null,
      soccerLeague: null,
      nflRookieIsRookie: null,
      nflRookieSource: null,
      lowConfidence: false,
      profileSource: 'sportsdataio',
      statsSource: 'sportsdataio',
      projectionsSource: 'sportsdataio',
      normalizedStats: { providerPayload: { secret: 'do-not-leak' } },
      normalizedProjections: { rawProviderPayload: { token: 'do-not-leak' } },
      nflRedraftPlayerMetadata: metadata,
      nflRedraftPlayerIntelligence: intelligence,
      nflRedraftGameContext: gameContext,
      nflRedraftLiveScoringContext: live,
      product: {
        unified: {} as UnifiedPlayerWireDto['product']['unified'],
        yearsExp: null,
        byeWeek: 10,
      },
    }
    const wirePackets = buildNflRedraftProviderEvidencePacketsFromWire(wire, {
      leagueId: 'league-g48',
      matchupId: 'matchup-1',
      ingestedAtIso: INGESTED,
    })

    expect(canonicalPackets.map((packet) => packet.evidenceType)).toEqual(
      expect.arrayContaining([
        'player_identity',
        'player_metadata_media',
        'projection',
        'injury',
        'news',
        'ranking_adp',
        'schedule_game_context',
        'weather',
        'live_stats',
        'fantasy_scoring',
        'stat_correction',
      ]),
    )
    expect(wirePackets.map((packet) => packet.evidenceType)).toEqual(
      expect.arrayContaining([
        'player_metadata_media',
        'projection',
        'injury',
        'schedule_game_context',
        'weather',
        'live_stats',
        'fantasy_scoring',
      ]),
    )
    for (const packet of [...canonicalPackets, ...wirePackets]) expectNoRawPayloadOrReasoning(packet)
  })
})
