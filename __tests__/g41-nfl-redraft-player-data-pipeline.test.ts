import { describe, expect, it } from 'vitest'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import {
  buildUnifiedPlayerProductView,
  type UnifiedPlayerProductView,
} from '@/lib/player-data/unifiedPlayerProductView'
import {
  buildNflRedraftCanonicalPlayer,
  type NflRedraftCanonicalPlayer,
} from '@/lib/player-data/nflRedraftCanonicalPlayer'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { adaptWaiverWirePlayer } from '@/lib/player-data/adapters/waiverPlayerAdapter'
import { tradeEvidenceFromUnifiedWire } from '@/lib/player-data/adapters/tradePlayerContextAdapter'
import { matchupContextFromUnifiedWire } from '@/lib/player-data/adapters/matchupPlayerAdapter'
import { displayPlayerFromUnifiedRow } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import { buildNflRedraftPlayerDataEvents } from '@/lib/player-data/nflRedraftPlayerDataEvents'

const NOW = new Date('2026-07-02T12:00:00.000Z')

function buildDraftEntry(overrides: Partial<NormalizedDraftEntry> = {}): NormalizedDraftEntry {
  return {
    playerId: 'sleeper-167',
    name: 'JaMarr Chase',
    position: 'WR',
    team: 'CIN',
    byeWeek: 10,
    yearsExp: 5,
    isRookie: false,
    adp: 3.2,
    projectionSource: 'rolling_insights',
    display: {
      playerId: 'sleeper-167',
      displayName: 'JaMarr Chase',
      sport: 'NFL',
      assets: {
        headshotUrl: 'https://cdn.test/chase.png',
        teamLogoUrl: 'https://cdn.test/cin.png',
      },
      team: {
        teamId: 'cin',
        abbreviation: 'CIN',
        displayName: 'Cincinnati Bengals',
        sport: 'NFL',
        logoUrl: 'https://cdn.test/cin.png',
      },
      stats: {
        fantasyPointsPerGame: 18.1,
        adp: 3.2,
        byeWeek: 10,
        projectionSource: 'rolling_insights',
      },
      metadata: {
        position: 'WR',
        teamAbbreviation: 'CIN',
        injuryStatus: 'Questionable',
        positionEligibility: ['WR', 'FLEX'],
        injuryUpdatedAt: '2026-07-02T08:30:00.000Z',
        age: 26,
        collegeOrPipeline: 'LSU',
        sport: 'NFL',
        externalSourceId: '167',
      },
    },
    nflDraftProjectionSplits: {
      projectedPoints: 310.6,
      projectedPointsPerGame: 21.4,
    } as NormalizedDraftEntry['nflDraftProjectionSplits'],
    ...overrides,
  } as unknown as NormalizedDraftEntry
}

function sampleView(overrides: Partial<UnifiedPlayerProductView['unified']> = {}): UnifiedPlayerProductView {
  const entry = buildDraftEntry()
  return {
    ...entry,
    unified: {
      playerId: 'sleeper-167',
      providerPlayerId: '167',
      sport: 'NFL' as UnifiedPlayerProductView['unified']['sport'],
      soccerLeague: null,
      fullName: 'JaMarr Chase',
      firstName: 'JaMarr',
      lastName: 'Chase',
      position: 'WR',
      positionCategory: 'WR',
      team: 'CIN',
      teamId: 'cin',
      teamAbbr: 'CIN',
      status: 'active',
      jerseyNumber: 1,
      headshotUrl: 'https://cdn.test/chase.png',
      imageSource: 'http_headshot',
      profileSource: 'sports_players',
      statsSource: 'rolling_insights',
      projectionsSource: 'sports_players.projections',
      liveSource: null,
      rookieSource: 'sleeper',
      adpSource: 'pool_adp',
      aiAdpSource: null,
      height: '6-0',
      weight: '201',
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
      yearsExperience: 5,
      yearsExpSource: 'sleeper',
      adp: 3.2,
      aiAdp: null,
      aiAdpSampleSize: null,
      projectedPoints: 21.4,
      fantasyPointsPerGame: 18.1,
      normalizedStats: {
        fantasyPointsPerGame: 18.1,
        cacheStats: {
          season: 2025,
          gamesPlayed: 17,
          fantasyPoints: 290.2,
          fantasyPointsPerGame: 17.1,
          receivingYards: 1216,
          receivingTouchdowns: 10,
          updatedAt: '2026-06-30T00:00:00.000Z',
          source: 'rolling_insights',
        },
      },
      normalizedProjections: {
        weeklyProjectedPoints: 21.4,
        seasonProjectedPoints: 310.6,
        restOfSeasonProjectedPoints: 260.3,
        scoringFormat: 'ppr',
        rank: 4,
        positionalRank: 2,
        source: 'sports_players.projections',
        updatedAt: '2026-07-02T09:00:00.000Z',
        newsSummary: 'Full participant in minicamp.',
        newsUpdatedAt: '2026-07-02T08:00:00.000Z',
      },
      liveStats: null,
      rawStatsReference: null,
      isDrafted: null,
      isOnRoster: null,
      isOnWaivers: null,
      isFreeAgent: null,
      isLocked: null,
      injuryStatus: 'Questionable',
      nflRookie: { isRookie: false, source: 'sleeper' },
      soccerPositionGroup: null,
      experience: {
        years: 5,
        isRookie: false,
        source: 'sleeper',
        confidence: 'high',
      },
      lowConfidence: false,
      ...overrides,
    },
  } as unknown as UnifiedPlayerProductView
}

function canonicalFrom(view: UnifiedPlayerProductView): NflRedraftCanonicalPlayer {
  const canonical = buildNflRedraftCanonicalPlayer(view, {
    now: NOW,
    teamLogoUrl: 'https://cdn.test/cin.png',
  })
  expect(canonical).not.toBeNull()
  return canonical!
}

describe('G41 NFL redraft player data pipeline', () => {
  it('keeps weekly projections separate from historical fantasy points per game', () => {
    const view = buildUnifiedPlayerProductView(buildDraftEntry())

    expect(view.unified.projectedPoints).toBe(21.4)
    expect(view.unified.fantasyPointsPerGame).toBe(18.1)
    expect(view.unified.normalizedProjections).toMatchObject({
      weeklyProjectedPoints: 21.4,
      seasonProjectedPoints: 310.6,
      nflDraftProjectionSplits: {
        projectedPoints: 310.6,
        projectedPointsPerGame: 21.4,
      },
    })
  })

  it('builds a canonical NFL redraft player with media, stats, projections, status, and eligibility', () => {
    const canonical = canonicalFrom(sampleView())

    expect(canonical).toMatchObject({
      playerId: 'sleeper-167',
      fullName: 'JaMarr Chase',
      teamAbbr: 'CIN',
      fantasyPosition: 'WR',
      byeWeek: 10,
      adp: 3.2,
      rank: 4,
      positionalRank: 2,
      activeStatus: 'active',
    })
    expect(canonical.providerIds.sleeperId).toBe('167')
    expect(canonical.rosterEligibility).toEqual(expect.arrayContaining(['WR', 'FLEX', 'WR_TE']))
    expect(canonical.media.headshot).toMatchObject({ url: 'https://cdn.test/chase.png', safeToRenderImage: true })
    expect(canonical.media.teamLogo).toMatchObject({ url: 'https://cdn.test/cin.png', safeToRenderImage: true })
    expect(canonical.historicalStats.previousSeason).toMatchObject({
      season: 2025,
      fantasyPoints: 290.2,
    })
    expect(canonical.historicalStats.previousSeason?.statLines.receivingYards).toBe(1216)
    expect(canonical.currentProjection).toMatchObject({
      weeklyProjectedPoints: 21.4,
      seasonProjectedPoints: 310.6,
      restOfSeasonProjectedPoints: 260.3,
      unavailable: false,
    })
    expect(canonical.news.summary).toBe('Full participant in minicamp.')
  })

  it('marks provider gaps and does not invent projections from FPPG', () => {
    const canonical = canonicalFrom(
      sampleView({
        providerPlayerId: null,
        headshotUrl: null,
        imageSource: 'missing',
        projectedPoints: null,
        normalizedStats: {},
        normalizedProjections: {},
        injuryStatus: null,
      }),
    )

    expect(canonical.currentProjection.weeklyProjectedPoints).toBeNull()
    expect(canonical.currentProjection.unavailable).toBe(true)
    expect(canonical.dataFreshness.projections).toBe('missing')
    expect(canonical.fallbacks.map((fallback) => fallback.field)).toEqual(
      expect.arrayContaining(['headshotUrl', 'historicalStats', 'currentProjection', 'injuryStatus', 'newsSummary', 'providerPlayerId']),
    )
  })

  it('surfaces stale provider warnings for stats, projections, injury, and news', () => {
    const staleView = sampleView({
      normalizedStats: {
        cacheStats: {
          season: 2025,
          fantasyPoints: 250,
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      },
      normalizedProjections: {
        weeklyProjectedPoints: 20,
        updatedAt: '2026-06-20T00:00:00.000Z',
        newsSummary: 'Old news item.',
        newsUpdatedAt: '2026-06-20T00:00:00.000Z',
      },
    })
    staleView.display.metadata.injuryUpdatedAt = '2026-06-20T00:00:00.000Z'
    const stale = canonicalFrom(staleView)

    expect(stale.dataFreshness.stats).toBe('stale')
    expect(stale.dataFreshness.projections).toBe('stale')
    expect(stale.dataFreshness.injury).toBe('stale')
    expect(stale.dataFreshness.news).toBe('stale')
    expect(stale.dataFreshness.staleWarnings).toEqual(
      expect.arrayContaining([
        'Stats data is stale as of 2026-06-01T00:00:00.000Z.',
        'Projection data is stale as of 2026-06-20T00:00:00.000Z.',
        'Injury data is stale as of 2026-06-20T00:00:00.000Z.',
        'News data is stale as of 2026-06-20T00:00:00.000Z.',
      ]),
    )
  })

  it('emits canonical player-data events for refreshes, changes, and fallbacks', () => {
    const current = canonicalFrom(sampleView())
    const previous: NflRedraftCanonicalPlayer = {
      ...current,
      teamAbbr: 'LAR',
      activeStatus: 'inactive',
      injury: { ...current.injury, designation: 'Out' },
      currentProjection: { ...current.currentProjection, weeklyProjectedPoints: 17.2 },
    }
    const currentWithFallback: NflRedraftCanonicalPlayer = {
      ...current,
      fallbacks: [{ field: 'newsSummary', reason: 'provider news unavailable', source: 'sports_players' }],
    }

    const events = buildNflRedraftPlayerDataEvents({
      leagueId: 'league-1',
      player: currentWithFallback,
      previous,
      occurredAtIso: '2026-07-02T12:00:00.000Z',
    })

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'player.data.refreshed',
        'player.status.changed',
        'player.injury.status_changed',
        'player.projection.updated',
        'player.team.changed',
        'player.data.fallback_used',
      ]),
    )
  })

  it('projects the canonical snapshot into waiver, trade, matchup, and display adapters', () => {
    const wire = serializeUnifiedPlayerForApi(sampleView())
    const waiver = adaptWaiverWirePlayer(wire)
    const trade = tradeEvidenceFromUnifiedWire(wire)
    const matchup = matchupContextFromUnifiedWire(wire)
    const display = displayPlayerFromUnifiedRow(wire)

    expect(wire.nflRedraft?.currentProjection.weeklyProjectedPoints).toBe(21.4)
    expect(waiver).toMatchObject({
      displayHeadshotUrl: 'https://cdn.test/chase.png',
      displayTeamLogoUrl: 'https://cdn.test/cin.png',
      displayProjection: 21.4,
      displayInjury: 'Questionable',
    })
    expect(trade).toMatchObject({
      headshotUrl: 'https://cdn.test/chase.png',
      teamLogoUrl: 'https://cdn.test/cin.png',
      projectedPoints: 21.4,
      injuryStatus: 'Questionable',
    })
    expect(matchup).toMatchObject({
      playerId: 'sleeper-167',
      headshotUrl: 'https://cdn.test/chase.png',
      teamLogoUrl: 'https://cdn.test/cin.png',
      projectedPoints: 21.4,
      activeStatus: 'active',
    })
    expect(display).toMatchObject({
      headshotUrl: 'https://cdn.test/chase.png',
      teamLogoUrl: 'https://cdn.test/cin.png',
      projectedPoints: 21.4,
      activeStatus: 'active',
    })
  })
})
