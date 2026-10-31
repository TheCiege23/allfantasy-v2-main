import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterTemplateDto, RosterTemplateSlotDto } from '@/lib/multi-sport/RosterTemplateService'
import {
  allowedPlayerPositionsFromTemplate,
  starterEligiblePlayerPositionsFromTemplate,
  type EffectiveLeagueRosterTemplate,
} from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { MLB_FANTRAX_UNIVERSE_CACHE_KEY } from '@/lib/player-identity/mlbFantraxProspects'
import { NHL_FANTRAX_UNIVERSE_CACHE_KEY } from '@/lib/player-identity/nhlFantraxProspects'

const hm = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  draftSessionFindUnique: vi.fn(),
  playerAnalyticsFindMany: vi.fn(),
  devyPlayerFindMany: vi.fn(),
  getLiveADP: vi.fn(),
  getPlayerPoolForLeague: vi.fn(),
  loadRollingInsightsSeasonByDraftPoolKey: vi.fn(),
  loadRollingInsightsStatsDetailByPlayerIds: vi.fn(),
  adpDataFindFirst: vi.fn(),
  adpDataFindMany: vi.fn(),
  listInjuryFacts: vi.fn(),
  playerSeasonStatsFindMany: vi.fn(),
  sportsPlayerFindMany: vi.fn(),
  sportsDataCacheFindUnique: vi.fn(),
  playerIdentityFindMany: vi.fn(),
}))

vi.mock('@/lib/injuries/injuryReadPort', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listInjuryFacts: (...a: unknown[]) => hm.listInjuryFacts(...a),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: hm.leagueFindUnique },
    draftSession: { findUnique: hm.draftSessionFindUnique, findFirst: hm.draftSessionFindUnique },
    playerAnalyticsSnapshot: { findMany: hm.playerAnalyticsFindMany },
    devyPlayer: { findMany: hm.devyPlayerFindMany },
    injuryReportRecord: { findMany: vi.fn().mockResolvedValue([]) },
    sportsPlayer: { findMany: hm.sportsPlayerFindMany },
    sportsPlayerRecord: { findMany: vi.fn().mockResolvedValue([]) },
    adpDataRecord: {
      findFirst: (...args: unknown[]) => hm.adpDataFindFirst(...args),
      findMany: (...args: unknown[]) => hm.adpDataFindMany(...args),
    },
    allFantasyAdpSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    playerSeasonStats: { findMany: (...args: unknown[]) => hm.playerSeasonStatsFindMany(...args) },
    sportsDataCache: { findUnique: (...args: unknown[]) => hm.sportsDataCacheFindUnique(...args) },
    playerIdentityMap: { findMany: (...args: unknown[]) => hm.playerIdentityFindMany(...args) },
    redraftSeason: { findFirst: vi.fn().mockResolvedValue(null) },
    redraftRosterPlayer: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/lib/adp-data', () => ({ getLiveADP: hm.getLiveADP }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: hm.getPlayerPoolForLeague }))
vi.mock('@/lib/devy', () => ({
  isDevyLeague: vi.fn().mockResolvedValue(false),
  getPromotedProPlayerIdsExcludedFromRookiePool: vi.fn().mockResolvedValue(new Set()),
}))
vi.mock('@/lib/merged-devy-c2c', () => ({
  isC2CLeague: vi.fn().mockResolvedValue(false),
  getC2CPromotedProPlayerIdsExcludedFromRookiePool: vi.fn().mockResolvedValue(new Set()),
}))
vi.mock('@/lib/draft/analytics/nfl-rolling-insights-draft-analytics', () => ({
  defaultNflPlayerStatsSeason: vi.fn(() => '2024'),
  loadRollingInsightsSeasonByDraftPoolKey: (...args: unknown[]) => hm.loadRollingInsightsSeasonByDraftPoolKey(...args),
  loadRollingInsightsStatsDetailByPlayerIds: (...args: unknown[]) => hm.loadRollingInsightsStatsDetailByPlayerIds(...args),
  loadPlayerSeasonStatsFallback: vi.fn().mockResolvedValue({
    seasonByPoolKey: new Map(),
    diagnostics: { exactIdHits: 0, namePositionHits: 0, ambiguousSkips: 0, misses: 0 },
  }),
  resolveNflDraftPoolAnalytics: vi.fn(() => ({ fantasyPointsPerGame: null, lifetimeValue: null, primarySource: 'snapshot' as const })),
}))

function slot(slotName: string, allowedPositions: string[], slotOrder: number): RosterTemplateSlotDto {
  return { slotName, allowedPositions, starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder }
}

function template(sport: 'MLB' | 'NHL'): EffectiveLeagueRosterTemplate {
  const positions = sport === 'MLB' ? ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'DH'] : ['C', 'LW', 'RW', 'D', 'G']
  const t: RosterTemplateDto = {
    templateId: `${sport}-unit`, sportType: sport, name: `${sport} unit`, formatType: 'DYNASTY',
    slots: positions.map((p, i) => slot(p, [p], i + 1)),
  }
  return {
    leagueId: 'league-unit', sport, formatType: 'DYNASTY', leagueVariant: null, idpEnabled: false, template: t,
    allowedPositions: allowedPlayerPositionsFromTemplate(t), starterEligiblePositions: starterEligiblePlayerPositionsFromTemplate(t),
    flexSlotNames: [], superflexSlotNames: [], hasPersistedRosterSchema: true,
  } as EffectiveLeagueRosterTemplate
}

const poolRow = (full_name: string, position: string, team: string, external_source_id: string) => ({
  full_name, position, team_abbreviation: team, external_source_id, sleeper_id: null, metadata: { source: 'rolling_insights' },
  injury_status: null, secondary_positions: [], image_url: null, player_id: null, status: null, age: 22,
})

/**
 * Two prospects (one signed, one unsigned); one linked to an MLB identity; one tracked but UNLINKED
 * (only his name proves it); one whose name is on the pro pool.
 */
const mlbUniverse = {
  at: '2026-10-30T00:00:00Z',
  rows: [
    ['06abc', 'Prospect, Signed', 'NYY', 'SS'],
    ['06abe', 'Free, Agent', '(N/A)', 'SP'],
    ['042sz', 'Smith, Will', 'LAD', 'C'],
    ['02z0s', 'Judge, Aaron', 'NYY', 'RF'],
    ['00aaa', 'Pro, Already', 'BOS', '1B'],
  ],
}
const nhlUniverse = { at: '2026-10-30T00:00:00Z', rows: [['04qyh', 'Madden, Tyler', 'MIN', 'RW']] }

async function loadPool() {
  return (await import('@/lib/draft-room/getResolvedDraftPoolForLeague')).getResolvedDraftPoolForLeague
}

const league = (sport: string) => ({ sport, leagueVariant: null, settings: {}, starters: [], season: 2026, isDynasty: true, leagueSettings: { draftType: 'snake' } })
const session = (playerPool: string, draftModeLabel: string | null) => ({ devyConfig: null, c2cConfig: null, keeperSelections: null, draftType: 'snake', playerPool, draftModeLabel })
const readKeys = () => hm.sportsDataCacheFindUnique.mock.calls.map((c) => (c[0] as { where: { cacheKey: string } }).where.cacheKey)

describe('MLB rookie draft: Fantrax prospects join the board', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.sportsPlayerFindMany.mockResolvedValue([])
    hm.listInjuryFacts.mockResolvedValue({ facts: [], newestFetchedAt: null, feedStale: false, coverage: { sourceAvailable: true, reason: null } })
    hm.leagueFindUnique.mockResolvedValue(league('MLB'))
    hm.draftSessionFindUnique.mockResolvedValue(session('rookies_only', null))
    hm.playerAnalyticsFindMany.mockResolvedValue([])
    hm.devyPlayerFindMany.mockResolvedValue([])
    hm.loadRollingInsightsSeasonByDraftPoolKey.mockResolvedValue({ identityByPoolKey: new Map(), riSeasonByPlayerId: new Map() })
    hm.loadRollingInsightsStatsDetailByPlayerIds.mockResolvedValue(new Map())
    hm.adpDataFindFirst.mockResolvedValue(null)
    hm.adpDataFindMany.mockResolvedValue([])
    hm.playerSeasonStatsFindMany.mockResolvedValue([])
    hm.getLiveADP.mockResolvedValue([])
    hm.getPlayerPoolForLeague.mockResolvedValue([poolRow('Already Pro', '1B', 'BOS', '7001')])
    hm.sportsDataCacheFindUnique.mockImplementation(async (args: { where: { cacheKey: string } }) => {
      const expiresAt = new Date(Date.now() + 86400000)
      if (args.where.cacheKey === MLB_FANTRAX_UNIVERSE_CACHE_KEY) return { data: mlbUniverse, expiresAt }
      if (args.where.cacheKey === NHL_FANTRAX_UNIVERSE_CACHE_KEY) return { data: nhlUniverse, expiresAt }
      return null
    })
    hm.playerIdentityFindMany.mockImplementation(async (args: { where: { sport?: string } }) =>
      args.where.sport === 'MLB'
        ? [
            { fantraxId: '042sz', normalizedName: 'will smith', canonicalName: 'Will Smith', currentTeam: 'LAD', position: 'C' },
            // Tracked, NOT linked to Fantrax: only the name keeps him off the prospect list.
            { fantraxId: null, normalizedName: 'aaron judge', canonicalName: 'Aaron Judge', currentTeam: 'NYY', position: 'RF' },
          ]
        : [])
  })

  it('a rookies-only MLB board offers the prospects as rookies, with club or none, under fantrax ids', async () => {
    const res = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('MLB'), limit: 50 })
    const prospects = res.entries.filter((e) => e.prospectSource === 'fantrax')
    expect(prospects.map((e) => [e.playerId, e.name, e.position, e.team]).sort()).toEqual([
      ['fantrax:06abc', 'Signed Prospect', 'SS', 'NYY'],
      ['fantrax:06abe', 'Agent Free', 'SP', null],
    ])
    expect(prospects.every((e) => e.isRookie === true)).toBe(true)
    expect(res.entries.filter((e) => /smith|judge|already/i.test(e.name)).every((e) => e.prospectSource !== 'fantrax')).toBe(true)
    expect(readKeys()).not.toContain(NHL_FANTRAX_UNIVERSE_CACHE_KEY)
  })

  it('the league rookie draft (draftModeLabel rookie) gets them too', async () => {
    hm.draftSessionFindUnique.mockResolvedValue(session('all', 'rookie'))
    const res = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('MLB'), limit: 50 })
    expect(res.entries.some((e) => e.playerId === 'fantrax:06abc')).toBe(true)
  })

  it('an MLB startup / redraft board reads no prospects at all', async () => {
    hm.draftSessionFindUnique.mockResolvedValue(session('all', null))
    const startup = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('MLB'), limit: 50 })
    expect(startup.entries.some((e) => e.prospectSource === 'fantrax')).toBe(false)
    expect(readKeys()).not.toContain(MLB_FANTRAX_UNIVERSE_CACHE_KEY)
  })

  it('an NHL rookie board is unchanged: NHL prospects only, and the MLB universe is never read', async () => {
    hm.leagueFindUnique.mockResolvedValue(league('NHL'))
    hm.getPlayerPoolForLeague.mockResolvedValue([poolRow('Some Center', 'C', 'EDM', '9100')])
    const res = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('NHL'), limit: 50 })
    expect(res.entries.filter((e) => e.prospectSource === 'fantrax').map((e) => e.playerId)).toEqual(['fantrax:04qyh'])
    expect(readKeys()).toContain(NHL_FANTRAX_UNIVERSE_CACHE_KEY)
    expect(readKeys()).not.toContain(MLB_FANTRAX_UNIVERSE_CACHE_KEY)
  })

  it('a failed prospect read leaves the MLB board as it was instead of failing the draft', async () => {
    hm.sportsDataCacheFindUnique.mockImplementation(async () => { throw new Error('db down') })
    const res = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('MLB'), limit: 50 })
    expect(res.entries.some((e) => e.prospectSource === 'fantrax')).toBe(false)
    expect(res.entries.some((e) => e.name === 'Already Pro')).toBe(true)
  })
})
