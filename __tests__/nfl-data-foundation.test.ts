import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({
  getResolvedDraftPoolForLeague: vi.fn(),
}))

import {
  buildCanonicalNflProjection,
  canonicalNflIdentityKey,
  dedupeCanonicalNflPlayers,
  playerMatchesRosteredKeys,
  sanitizeCanonicalNflAiContext,
} from '@/lib/nfl-data-foundation/nflDataFoundationService'
import { getCanonicalNflDataCoverage } from '@/lib/nfl-data-foundation/nflDataCoverage'
import type { CanonicalNflAiContext, CanonicalNflPlayer } from '@/lib/nfl-data-foundation/types'

function canonicalPlayer(overrides: Partial<CanonicalNflPlayer>): CanonicalNflPlayer {
  return {
    playerId: 'af-1',
    playerName: 'Test Player',
    normalizedName: 'test player',
    position: 'RB',
    team: 'SF',
    teamId: null,
    jerseyNumber: null,
    status: null,
    injuryStatus: null,
    headshotUrl: null,
    byeWeek: null,
    opponent: null,
    depthChartRank: null,
    depthChartRole: null,
    providerIds: {
      allFantasyId: 'af-1',
      providerPlayerId: null,
      rollingInsightsId: null,
      sleeperId: null,
      fantasyCalcId: null,
    },
    seasonStats: null,
    projection: null,
    adp: null,
    tradeValue: null,
    dataSources: [],
    staleDataWarnings: [],
    ...overrides,
  }
}

function coverageModel(count: number, dateField: string, latest: Date | null) {
  return {
    count: vi.fn().mockResolvedValue(count),
    findFirst: vi.fn().mockResolvedValue(latest ? { [dateField]: latest } : null),
  }
}

describe('NFL data foundation', () => {
  it('uses provider IDs first and strict name/team fallback before AF row IDs', () => {
    expect(canonicalNflIdentityKey({ playerId: 'af-a', rollingInsightsId: 'ri-1', name: 'Christian McCaffrey', position: 'RB', team: 'SF' })).toBe('ri:ri-1')
    expect(canonicalNflIdentityKey({ playerId: 'af-a', sleeperId: 'sl-1', name: 'Christian McCaffrey', position: 'RB', team: 'SF' })).toBe('sleeper:sl-1')
    expect(canonicalNflIdentityKey({ playerId: 'af-a', name: 'Christian McCaffrey', position: 'RB', team: 'SF' })).toBe('name:christian mccaffrey|RB|SF')
  })

  it('prevents duplicate draft/waiver rows when only strict name/team identity is available', () => {
    const deduped = dedupeCanonicalNflPlayers([
      canonicalPlayer({ playerId: 'af-a', providerIds: { allFantasyId: 'af-a', providerPlayerId: null, rollingInsightsId: null, sleeperId: null, fantasyCalcId: null } }),
      canonicalPlayer({ playerId: 'af-b', providerIds: { allFantasyId: 'af-b', providerPlayerId: null, rollingInsightsId: null, sleeperId: null, fantasyCalcId: null } }),
    ])

    expect(deduped).toHaveLength(1)
  })

  it('lowers confidence when projections fall back to ADP/rank only', () => {
    const projection = buildCanonicalNflProjection({
      playerId: 'af-1',
      playerName: 'Fallback Runner',
      position: 'RB',
      team: 'SF',
      season: 2026,
      week: 2,
      adp: 36,
    })

    expect(projection.projectionSource).toBe('adp_fallback')
    expect(projection.confidenceLevel).toBe('low')
    expect(projection.reasonCodes).toContain('adp_fallback')
  })

  it('sets bye-week projection to zero and unavailable', () => {
    const projection = buildCanonicalNflProjection({
      playerId: 'af-1',
      playerName: 'Bye Runner',
      position: 'RB',
      team: 'SF',
      season: 2026,
      week: 7,
      byeWeek: 7,
      rollingInsightsFantasyPointsPerGame: 14.2,
      rollingInsightsGamesPlayed: 8,
    })

    expect(projection.projectedPoints).toBe(0)
    expect(projection.unavailable).toBe(true)
    expect(projection.reasonCodes).toContain('bye_week')
  })

  it('reduces OUT players to zero and marks them unavailable', () => {
    const projection = buildCanonicalNflProjection({
      playerId: 'af-1',
      playerName: 'Injured Receiver',
      position: 'WR',
      team: 'DAL',
      season: 2026,
      week: 4,
      injuryStatus: 'OUT',
      providerWeeklyProjection: 12.5,
    })

    expect(projection.projectedPoints).toBe(0)
    expect(projection.unavailable).toBe(true)
    expect(projection.reasonCodes).toContain('injury_status_adjustment')
  })

  it('reports stale and missing provider coverage without fabricating availability', async () => {
    const now = new Date('2026-09-15T00:00:00.000Z')
    const fakeDb = {
      sportsPlayer: coverageModel(500, 'fetchedAt', new Date('2026-08-01T00:00:00.000Z')),
      sportsTeam: coverageModel(32, 'fetchedAt', now),
      gameSchedule: coverageModel(272, 'updatedAt', now),
      depthChart: coverageModel(0, 'fetchedAt', null),
      playerSeasonStats: coverageModel(0, 'fetchedAt', null),
      sportsInjury: coverageModel(0, 'fetchedAt', null),
      injuryReportRecord: coverageModel(0, 'reportDate', null),
      fantasyProjection: coverageModel(0, 'fetchedAt', null),
      aFProjectionSnapshot: coverageModel(0, 'computedAt', null),
      sportsPlayerRecord: coverageModel(100, 'lastUpdated', now),
      sportsDataCache: coverageModel(0, 'createdAt', null),
    }

    const coverage = await getCanonicalNflDataCoverage({
      season: 2026,
      week: 1,
      now,
      prismaClient: fakeDb as never,
    })

    expect(coverage.hasPlayers).toBe(true)
    expect(coverage.staleFields).toContain('players')
    expect(coverage.missingFields).toEqual(expect.arrayContaining(['depth charts', 'season stats', 'injuries', 'weekly projections', 'ROS projections']))
  })

  it('waiver identity matching excludes rostered players without relying on raw provider rows', () => {
    const rostered = new Set([
      'player-1',
      'name:christian mccaffrey|RB|SF',
    ])

    expect(playerMatchesRosteredKeys({ id: 'player-1', name: 'Other', position: 'RB', team: 'SF' }, rostered)).toBe(true)
    expect(playerMatchesRosteredKeys({ name: 'Christian McCaffrey', position: 'RB', team: 'SF' }, rostered)).toBe(true)
    expect(playerMatchesRosteredKeys({ name: 'Breece Hall', position: 'RB', team: 'NYJ' }, rostered)).toBe(false)
  })

  it('sanitizes Chimmy context to normalized facts only', () => {
    const context: CanonicalNflAiContext = {
      leagueId: 'league-1',
      rosterId: 'roster-1',
      week: 1,
      purpose: 'lineup',
      players: [
        {
          playerId: 'af-1',
          playerName: 'Grounded Player',
          position: 'RB',
          team: 'SF',
          injuryStatus: null,
          byeWeek: null,
          projectedPoints: 12,
          restOfSeason: 180,
          confidence: 72,
          projectionSource: 'rolling_insights',
          tradeValue: 5000,
          depthChartRole: 'starter',
          dataSources: ['rolling_insights'],
          staleDataWarnings: [],
        },
      ],
      waiverOptions: [],
      rosterNeeds: ['WR depth'],
      coverage: {
        sport: 'NFL',
        season: 2026,
        week: 1,
        hasPlayers: true,
        hasTeams: true,
        hasSchedule: true,
        hasDepthCharts: true,
        hasSeasonStats: true,
        hasInjuries: true,
        hasWeeklyProjections: true,
        hasRosProjections: false,
        hasTradeValues: true,
        missingFields: [],
        staleFields: [],
        lastFetchedAt: {},
        counts: {},
        generatedAt: '2026-09-01T00:00:00.000Z',
      },
      dataWarnings: [],
      promptRules: ['Do not invent raw provider values.'],
    }

    const serialized = JSON.stringify(sanitizeCanonicalNflAiContext(context))
    expect(serialized).not.toMatch(/regularSeason|DK_fantasy_points|rawProvider|apiKey/i)
    expect(serialized).toContain('Grounded Player')
  })

  it('wires draft, waiver, trade, matchup, War Room, and Commissioner Hub surfaces to canonical NFL data', () => {
    const root = process.cwd()
    const draftRoute = fs.readFileSync(path.join(root, 'app/api/leagues/[leagueId]/draft/pool/route.ts'), 'utf8')
    const waiverRoute = fs.readFileSync(path.join(root, 'app/api/waiver-wire/leagues/[leagueId]/players/route.ts'), 'utf8')
    const tradeContext = fs.readFileSync(path.join(root, 'lib/trades/buildNormalizedTradeContext.ts'), 'utf8')
    const matchupRoute = fs.readFileSync(path.join(root, 'app/api/redraft/matchup/route.ts'), 'utf8')
    const warRoomContext = fs.readFileSync(path.join(root, 'lib/redraft-war-room/redraftWarRoomContext.ts'), 'utf8')
    const commissionerHub = fs.readFileSync(path.join(root, 'lib/commissioner-hub/commissionerHubHealth.ts'), 'utf8')

    expect(draftRoute).toContain('enrichCanonicalNflDraftPoolEntries')
    /*
     * ⚠ THE MARKER MOVED, THE WIRING DID NOT. `nflfoundation_v1` was inline in this route's
     * cache key until 6fad57e47 hoisted it into DRAFT_POOL_CACHE_VERSION in
     * lib/draft-room/ensureDraftPoolReady. Asserting on the route's own text then failed while
     * the feature was entirely intact — the same trap CLAUDE.md records for provider URLs, where
     * hoisting a literal into a shared constant retires the check that guarded it.
     *
     * Assert on the definition site AND on the route consuming it, so the check survives the
     * next refactor of the same shape. The route reaches the version through
     * `buildDraftPoolCacheKey`, which encapsulates it — not through the constant directly.
     */
    const draftPoolCacheVersion = fs.readFileSync(
      path.join(root, 'lib/draft-room/ensureDraftPoolReady.ts'),
      'utf8',
    )
    expect(draftPoolCacheVersion).toContain('nflfoundation_v1')
    expect(draftRoute).toContain('buildDraftPoolCacheKey')
    expect(waiverRoute).toContain('getCanonicalNflRosteredIdentityKeysForLeague')
    expect(waiverRoute).toContain('playerMatchesRosteredKeys')
    expect(tradeContext).toContain('weeklyProjectionDelta')
    expect(tradeContext).toContain('fantasyCalcValue')
    expect(matchupRoute).toContain('getCanonicalNflMatchupContext')
    expect(warRoomContext).toContain('getCanonicalNflDataCoverage')
    expect(commissionerHub).toContain('nflDataCoverage')
  })
})
