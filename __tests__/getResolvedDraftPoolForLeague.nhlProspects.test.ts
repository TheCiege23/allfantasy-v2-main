import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterTemplateDto, RosterTemplateSlotDto } from '@/lib/multi-sport/RosterTemplateService'
import {
  allowedPlayerPositionsFromTemplate,
  starterEligiblePlayerPositionsFromTemplate,
  type EffectiveLeagueRosterTemplate,
} from '@/lib/league/getEffectiveLeagueRosterTemplate'
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

vi.mock('@/lib/adp-data', () => ({
  getLiveADP: hm.getLiveADP,
}))

vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForLeague: hm.getPlayerPoolForLeague,
}))

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
  loadRollingInsightsStatsDetailByPlayerIds: (...args: unknown[]) =>
    hm.loadRollingInsightsStatsDetailByPlayerIds(...args),
  loadPlayerSeasonStatsFallback: vi.fn().mockResolvedValue({
    seasonByPoolKey: new Map(),
    diagnostics: { exactIdHits: 0, namePositionHits: 0, ambiguousSkips: 0, misses: 0 },
  }),
  resolveNflDraftPoolAnalytics: vi.fn(() => ({
    fantasyPointsPerGame: null,
    lifetimeValue: null,
    primarySource: 'snapshot' as const,
  })),
}))



function slot(slotName: string, allowedPositions: string[], starterCount: number, benchCount: number, slotOrder: number): RosterTemplateSlotDto {
  return { slotName, allowedPositions, starterCount, benchCount, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder }
}

function template(sport: 'NHL' | 'NBA'): EffectiveLeagueRosterTemplate {
  const positions = sport === 'NHL' ? ['C', 'LW', 'RW', 'D', 'G'] : ['PG']
  const t: RosterTemplateDto = {
    templateId: `${sport}-unit`, sportType: sport, name: `${sport} unit`, formatType: 'DYNASTY',
    slots: positions.map((p, i) => slot(p, [p], 1, 0, i + 1)),
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

/** Universe: two prospects, one already linked to an NHL identity, one whose name is in the pro pool. */
const universe = {
  at: '2026-10-30T00:00:00Z',
  rows: [
    ['04qyh', 'Madden, Tyler', 'MIN', 'RW'],
    ['04qyf', 'Hillis, Cameron', '(N/A)', 'C'],
    ['04qyi', 'Ragnarsson, Jacob', 'NYR', 'D'],
    ['00aaa', 'Pro, Already', 'EDM', 'C'],
  ],
}

async function loadPool() {
  return (await import('@/lib/draft-room/getResolvedDraftPoolForLeague')).getResolvedDraftPoolForLeague
}

describe('NHL rookie draft: Fantrax prospects join the board', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.sportsPlayerFindMany.mockResolvedValue([])
    hm.listInjuryFacts.mockResolvedValue({ facts: [], newestFetchedAt: null, feedStale: false, coverage: { sourceAvailable: true, reason: null } })
    hm.leagueFindUnique.mockResolvedValue({ sport: 'NHL', leagueVariant: null, settings: {}, starters: [], season: 2026, isDynasty: true, leagueSettings: { draftType: 'snake' } })
    hm.draftSessionFindUnique.mockResolvedValue({ devyConfig: null, c2cConfig: null, keeperSelections: null, draftType: 'snake', playerPool: 'rookies_only', draftModeLabel: null })
    hm.playerAnalyticsFindMany.mockResolvedValue([])
    hm.devyPlayerFindMany.mockResolvedValue([])
    hm.loadRollingInsightsSeasonByDraftPoolKey.mockResolvedValue({ identityByPoolKey: new Map(), riSeasonByPlayerId: new Map() })
    hm.loadRollingInsightsStatsDetailByPlayerIds.mockResolvedValue(new Map())
    hm.adpDataFindFirst.mockResolvedValue(null)
    hm.adpDataFindMany.mockResolvedValue([])
    hm.playerSeasonStatsFindMany.mockResolvedValue([])
    hm.getLiveADP.mockResolvedValue([])
    hm.getPlayerPoolForLeague.mockResolvedValue([poolRow('Already Pro', 'C', 'EDM', '7001')])
    hm.sportsDataCacheFindUnique.mockImplementation(async (args: { where: { cacheKey: string } }) =>
      args.where.cacheKey === NHL_FANTRAX_UNIVERSE_CACHE_KEY ? { data: universe, expiresAt: new Date(Date.now() + 86400000) } : null)
    hm.playerIdentityFindMany.mockResolvedValue([{ fantraxId: '04qyi', normalizedName: 'jacob ragnarsson', canonicalName: 'Jacob Ragnarsson' }])
  })

  it('a rookies-only NHL board offers the prospects as rookies, with org or no club, under fantrax ids', async () => {
    const res = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('NHL'), limit: 50 })
    const prospects = res.entries.filter((e) => e.prospectSource === 'fantrax')
    expect(prospects.map((e) => [e.playerId, e.name, e.position, e.team]).sort()).toEqual([
      ['fantrax:04qyf', 'Cameron Hillis', 'C', null],
      ['fantrax:04qyh', 'Tyler Madden', 'RW', 'MIN'],
    ])
    expect(prospects.every((e) => e.isRookie === true)).toBe(true)
    // Linked to an NHL identity, or already on the pro pool: never a second copy.
    expect(res.entries.filter((e) => /ragnarsson|already/i.test(e.name)).every((e) => e.prospectSource !== 'fantrax')).toBe(true)
  })

  it('the league rookie draft (draftModeLabel rookie) gets them too', async () => {
    hm.draftSessionFindUnique.mockResolvedValue({ devyConfig: null, c2cConfig: null, keeperSelections: null, draftType: 'linear', playerPool: 'all', draftModeLabel: 'rookie' })
    const res = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('NHL'), limit: 50 })
    expect(res.entries.some((e) => e.playerId === 'fantrax:04qyh')).toBe(true)
  })

  it('a startup / redraft NHL board, and an NBA rookie board, read no prospects at all', async () => {
    hm.draftSessionFindUnique.mockResolvedValue({ devyConfig: null, c2cConfig: null, keeperSelections: null, draftType: 'snake', playerPool: 'all', draftModeLabel: null })
    const startup = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('NHL'), limit: 50 })
    expect(startup.entries.some((e) => e.prospectSource === 'fantrax')).toBe(false)
    expect(hm.sportsDataCacheFindUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { cacheKey: NHL_FANTRAX_UNIVERSE_CACHE_KEY } }))

    hm.leagueFindUnique.mockResolvedValue({ sport: 'NBA', leagueVariant: null, settings: {}, starters: [], season: 2026, isDynasty: true, leagueSettings: { draftType: 'snake' } })
    hm.draftSessionFindUnique.mockResolvedValue({ devyConfig: null, c2cConfig: null, keeperSelections: null, draftType: 'snake', playerPool: 'rookies_only', draftModeLabel: 'rookie' })
    hm.getPlayerPoolForLeague.mockResolvedValue([poolRow('Some Guard', 'PG', 'BOS', '5001')])
    const nba = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('NBA'), limit: 50 })
    expect(nba.entries.some((e) => e.prospectSource === 'fantrax')).toBe(false)
    expect(hm.sportsDataCacheFindUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { cacheKey: NHL_FANTRAX_UNIVERSE_CACHE_KEY } }))
  })

  it('a failed prospect read leaves the board as it was instead of failing the draft', async () => {
    hm.sportsDataCacheFindUnique.mockImplementation(async () => { throw new Error('db down') })
    const res = await (await loadPool())('league-unit', { effectiveLeagueTemplate: template('NHL'), limit: 50 })
    expect(res.entries.some((e) => e.prospectSource === 'fantrax')).toBe(false)
  })
})
