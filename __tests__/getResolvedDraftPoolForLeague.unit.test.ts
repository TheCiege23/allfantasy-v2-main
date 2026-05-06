import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterTemplateDto, RosterTemplateSlotDto } from '@/lib/multi-sport/RosterTemplateService'
import {
  allowedPlayerPositionsFromTemplate,
  starterEligiblePlayerPositionsFromTemplate,
  type EffectiveLeagueRosterTemplate,
} from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { emptyNflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import { normalizeDraftPoolNameForDedupe } from '@/lib/draft-room/getResolvedDraftPoolForLeague'

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
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: hm.leagueFindUnique },
    draftSession: { findUnique: hm.draftSessionFindUnique },
    playerAnalyticsSnapshot: { findMany: hm.playerAnalyticsFindMany },
    devyPlayer: { findMany: hm.devyPlayerFindMany },
    injuryReportRecord: { findMany: vi.fn().mockResolvedValue([]) },
    sportsPlayer: { findMany: vi.fn().mockResolvedValue([]) },
    sportsPlayerRecord: { findMany: vi.fn().mockResolvedValue([]) },
    adpDataRecord: {
      findFirst: (...args: unknown[]) => hm.adpDataFindFirst(...args),
      findMany: (...args: unknown[]) => hm.adpDataFindMany(...args),
    },
    allFantasyAdpSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    playerSeasonStats: { findMany: vi.fn().mockResolvedValue([]) },
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

function slot(
  slotName: string,
  allowedPositions: string[],
  starterCount: number,
  benchCount: number,
  slotOrder: number,
  isFlexibleSlot = false,
): RosterTemplateSlotDto {
  return {
    slotName,
    allowedPositions,
    starterCount,
    benchCount,
    reserveCount: 0,
    taxiCount: 0,
    devyCount: 0,
    isFlexibleSlot,
    slotOrder,
  }
}

/** Starters include no K; BN may list K for bench-only eligibility. */
function nflTemplateNoKStarters(): RosterTemplateDto {
  return {
    templateId: 'unit-no-k',
    sportType: 'NFL',
    name: 'Unit no K starters',
    formatType: 'REDRAFT',
    slots: [
      slot('QB', ['QB'], 1, 0, 1),
      slot('RB', ['RB'], 2, 0, 2),
      slot('WR', ['WR'], 2, 0, 3),
      slot('TE', ['TE'], 1, 0, 4),
      slot('FLEX', ['RB', 'WR', 'TE'], 1, 0, 5, true),
      slot('DST', ['DST', 'DEF'], 1, 0, 6),
      slot('BN', ['QB', 'RB', 'WR', 'TE', 'K', 'DST'], 0, 6, 7),
    ],
  }
}

function effectiveNflNoK(overrides: Partial<EffectiveLeagueRosterTemplate> = {}): EffectiveLeagueRosterTemplate {
  const template = nflTemplateNoKStarters()
  return {
    leagueId: 'league-unit',
    sport: 'NFL',
    formatType: 'REDRAFT',
    leagueVariant: null,
    idpEnabled: false,
    template,
    allowedPositions: allowedPlayerPositionsFromTemplate(template),
    starterEligiblePositions: starterEligiblePlayerPositionsFromTemplate(template),
    flexSlotNames: ['FLEX'],
    superflexSlotNames: [],
    hasPersistedRosterSchema: true,
    ...overrides,
  }
}

async function loadPool() {
  const mod = await import('@/lib/draft-room/getResolvedDraftPoolForLeague')
  return mod.getResolvedDraftPoolForLeague
}

describe('normalizeDraftPoolNameForDedupe', () => {
  it('matches drafted-name Sets', () => {
    expect(normalizeDraftPoolNameForDedupe('  Patrick Mahomes ')).toBe('patrick mahomes')
    expect(normalizeDraftPoolNameForDedupe('Star Rb')).toBe('star rb')
  })
})

describe('getResolvedDraftPoolForLeague', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.leagueFindUnique.mockResolvedValue({
      sport: 'NFL',
      leagueVariant: null,
      settings: {},
      starters: [{ slot: 'QB' }],
      leagueSettings: { draftType: 'snake' },
    })
    hm.draftSessionFindUnique.mockResolvedValue({
      devyConfig: null,
      c2cConfig: null,
      keeperSelections: null,
      draftType: 'snake',
    })
    hm.playerAnalyticsFindMany.mockResolvedValue([])
    hm.devyPlayerFindMany.mockResolvedValue([])
    hm.loadRollingInsightsSeasonByDraftPoolKey.mockResolvedValue({
      identityByPoolKey: new Map(),
      riSeasonByPlayerId: new Map(),
    })
    hm.loadRollingInsightsStatsDetailByPlayerIds.mockResolvedValue(new Map())
    hm.adpDataFindFirst.mockResolvedValue(null)
    hm.adpDataFindMany.mockResolvedValue([])
  })

  it('returns empty pool when roster schema is not persisted', async () => {
    const getResolvedDraftPoolForLeague = await loadPool()
    const res = await getResolvedDraftPoolForLeague('league-unit', {
      effectiveLeagueTemplate: {
        sport: 'NFL',
        hasPersistedRosterSchema: false,
        idpEnabled: false,
      } as EffectiveLeagueRosterTemplate,
    })
    expect(res.rosterConfigurationIncomplete).toBe(true)
    expect(res.entries).toEqual([])
    expect(res.count).toBe(0)
    expect(hm.leagueFindUnique).not.toHaveBeenCalled()
  })

  it('excludes K/PK when kicker is not starter-eligible', async () => {
    const starters = starterEligiblePlayerPositionsFromTemplate(nflTemplateNoKStarters())
    expect(starters.has('K')).toBe(false)

    const getResolvedDraftPoolForLeague = await loadPool()
    hm.getLiveADP.mockResolvedValue([
      { name: 'Justin Tucker', position: 'PK', team: 'BAL', adp: 1, bye: 8 },
      { name: 'Nick Chubb', position: 'RB', team: 'CLE', adp: 2, bye: 9 },
    ])
    hm.getPlayerPoolForLeague.mockResolvedValue([
      {
        full_name: 'Justin Tucker',
        position: 'K',
        team_abbreviation: 'BAL',
        external_source_id: 'k-1',
        injury_status: null,
        secondary_positions: [],
        image_url: null,
        player_id: null,
        status: null,
        age: null,
      },
      {
        full_name: 'Nick Chubb',
        position: 'RB',
        team_abbreviation: 'CLE',
        external_source_id: 'rb-1',
        injury_status: null,
        secondary_positions: [],
        image_url: null,
        player_id: null,
        status: null,
        age: null,
      },
    ])

    const res = await getResolvedDraftPoolForLeague('league-unit', {
      effectiveLeagueTemplate: effectiveNflNoK(),
    })

    expect(res.rosterConfigurationIncomplete).toBe(false)
    const names = res.entries.map((e) => e.name.toLowerCase())
    expect(names.some((n) => n.includes('tucker'))).toBe(false)
    expect(names.some((n) => n.includes('chubb'))).toBe(true)
    for (const e of res.entries) {
      const pos = String(e.position ?? e.display?.metadata?.position ?? '').toUpperCase()
      expect(pos === 'K' || pos === 'PK').toBe(false)
    }
  })

  it('merges DB pool onto ADP rows preserving ADP order and enriching playerId, sleeperId, imageUrl, and display headshot', async () => {
    const getResolvedDraftPoolForLeague = await loadPool()
    hm.adpDataFindFirst.mockResolvedValue({ season: 2025, week: 1 })
    hm.adpDataFindMany.mockResolvedValue([
      { playerName: 'Merge Adp Star', position: 'RB', team: 'ZZZ', source: 'espn', adp: 1.5 },
      { playerName: 'Later Adp', position: 'WR', team: 'AAA', source: 'espn', adp: 99 },
    ])
    hm.getLiveADP.mockResolvedValue([
      { name: 'Merge Adp Star', position: 'RB', team: 'ZZZ', adp: 1.5, bye: 5 },
      { name: 'Later Adp', position: 'WR', team: 'AAA', adp: 99, bye: 6 },
    ])
    hm.getPlayerPoolForLeague.mockResolvedValue([
      {
        full_name: 'Merge Adp Star',
        position: 'RB',
        team_abbreviation: 'ZZZ',
        external_source_id: 'ext-merge-1',
        injury_status: null,
        secondary_positions: [],
        image_url: 'https://cdn.example/merge.png',
        player_id: 'legacy-merge',
        status: null,
        age: 24,
      },
    ])

    const res = await getResolvedDraftPoolForLeague('league-unit', {
      effectiveLeagueTemplate: effectiveNflNoK(),
      limit: 120,
    })

    expect(res.entries.length).toBeGreaterThanOrEqual(2)
    const mergeIdx = res.entries.findIndex((e) => e.name === 'Merge Adp Star')
    const laterIdx = res.entries.findIndex((e) => e.name === 'Later Adp')
    expect(mergeIdx).toBeGreaterThanOrEqual(0)
    expect(laterIdx).toBeGreaterThanOrEqual(0)
    expect(mergeIdx).toBeLessThan(laterIdx)

    const merge = res.entries[mergeIdx]!
    expect(merge.adp).toBe(1.5)
    expect(merge.display.playerId).toBe('ext-merge-1')
    expect(merge.display.assets.headshotUrl).toBe('https://cdn.example/merge.png')
    expect(merge.playerId).toBe('ext-merge-1')
  })

  it('excludes drafted players by normalized name and by player id', async () => {
    const getResolvedDraftPoolForLeague = await loadPool()
    hm.getLiveADP.mockResolvedValue([
      { name: 'Alpha One', position: 'RB', team: 'A', adp: 1, bye: 1 },
      { name: 'Beta Two', position: 'WR', team: 'B', adp: 2, bye: 2 },
      { name: 'Gamma Three', position: 'TE', team: 'C', adp: 3, bye: 3 },
    ])
    hm.getPlayerPoolForLeague.mockResolvedValue([
      {
        full_name: 'Alpha One',
        position: 'RB',
        team_abbreviation: 'A',
        external_source_id: 'id-alpha',
        injury_status: null,
        secondary_positions: [],
        image_url: null,
        player_id: null,
        status: null,
        age: null,
      },
      {
        full_name: 'Beta Two',
        position: 'WR',
        team_abbreviation: 'B',
        external_source_id: 'id-beta',
        injury_status: null,
        secondary_positions: [],
        image_url: null,
        player_id: null,
        status: null,
        age: null,
      },
      {
        full_name: 'Gamma Three',
        position: 'TE',
        team_abbreviation: 'C',
        external_source_id: 'id-gamma',
        injury_status: null,
        secondary_positions: [],
        image_url: null,
        player_id: null,
        status: null,
        age: null,
      },
    ])

    const res = await getResolvedDraftPoolForLeague('league-unit', {
      effectiveLeagueTemplate: effectiveNflNoK(),
      excludeDraftedNames: new Set(['alpha one']),
      excludeDraftedPlayerIds: new Set(['id-beta']),
    })

    const names = new Set(res.entries.map((e) => e.name))
    expect(names.has('Alpha One')).toBe(false)
    expect(names.has('Beta Two')).toBe(false)
    expect(names.has('Gamma Three')).toBe(true)
  })

  it('Block B.2-A/C — non-NFL pool rows carry sport + age + rookie inference metadata through to normalized entries', async () => {
    const getResolvedDraftPoolForLeague = await loadPool()

    // Switch league to NBA so the resolver hits the non-NFL else branch.
    hm.leagueFindUnique.mockResolvedValue({
      sport: 'NBA',
      leagueVariant: null,
      settings: {},
      starters: [{ slot: 'PG' }],
      leagueSettings: { draftType: 'snake' },
    })
    // No ADP → forces SportsPlayer-fallback path (the branch that surfaces
    // the rookie-inference fields from p.* into the rawList row).
    hm.adpDataFindFirst.mockResolvedValue(null)
    hm.adpDataFindMany.mockResolvedValue([])
    hm.getLiveADP.mockResolvedValue([])
    hm.getPlayerPoolForLeague.mockResolvedValue([
      {
        full_name: 'Rookie Guard',
        position: 'PG',
        team_abbreviation: 'BOS',
        external_source_id: 'nba-rookie-1',
        injury_status: null,
        secondary_positions: [],
        image_url: null,
        player_id: null,
        status: null,
        age: 19,
        draft_year: new Date().getFullYear(),
        class_year: 'FR',
        class_year_label: 'FR',
      },
      {
        full_name: 'Mlb Debut',
        position: 'PG',
        team_abbreviation: 'BOS',
        external_source_id: 'mlb-1',
        injury_status: null,
        secondary_positions: [],
        image_url: null,
        player_id: null,
        status: null,
        age: 22,
        debut_year: new Date().getFullYear(),
      },
    ])

    const res = await getResolvedDraftPoolForLeague('league-unit', {
      effectiveLeagueTemplate: {
        sport: 'NBA',
        formatType: 'REDRAFT',
        leagueVariant: null,
        idpEnabled: false,
        template: {
          templateId: 'nba-unit',
          sportType: 'NBA',
          name: 'NBA unit',
          formatType: 'REDRAFT',
          slots: [slot('PG', ['PG'], 1, 0, 1), slot('BN', ['PG', 'SG', 'SF'], 0, 4, 2)],
        },
        allowedPositions: new Set(['PG', 'SG', 'SF']),
        starterEligiblePositions: new Set(['PG']),
        flexSlotNames: [],
        superflexSlotNames: [],
        hasPersistedRosterSchema: true,
      } as EffectiveLeagueRosterTemplate,
      limit: 50,
    })

    const rookie = res.entries.find((e) => e.name === 'Rookie Guard')
    expect(rookie).toBeDefined()
    // sport propagated through normalization (PlayerDisplayModel.sport).
    expect(rookie!.display.sport).toBe('NBA')
    // Top-level age lifted by Block B.2-C so the predicate can branch on it.
    expect(rookie!.age).toBe(19)
    // Year fields carried through verbatim.
    expect(rookie!.draftYear).toBe(new Date().getFullYear())
    // class_year (snake_case from upstream) → classYear (camelCase top level).
    expect(rookie!.classYear).toBe('FR')
    // class_year_label preserved on the existing top-level classYearLabel field.
    expect(rookie!.classYearLabel).toBe('FR')

    const debut = res.entries.find((e) => e.name === 'Mlb Debut')
    expect(debut).toBeDefined()
    // debut_year reaches the predicate as debutYear at the top level.
    expect(debut!.debutYear).toBe(new Date().getFullYear())
    expect(debut!.age).toBe(22)
  })

  it('attaches NFL projection splits using empty model when no projection data (no fake zeros)', async () => {
    const getResolvedDraftPoolForLeague = await loadPool()
    hm.getLiveADP.mockResolvedValue([{ name: 'Plain Rb', position: 'RB', team: 'X', adp: 10, bye: 1 }])
    hm.getPlayerPoolForLeague.mockResolvedValue([
      {
        full_name: 'Plain Rb',
        position: 'RB',
        team_abbreviation: 'X',
        external_source_id: 'plain-1',
        injury_status: null,
        secondary_positions: [],
        image_url: null,
        player_id: null,
        status: null,
        age: null,
      },
    ])

    const res = await getResolvedDraftPoolForLeague('league-unit', {
      effectiveLeagueTemplate: effectiveNflNoK(),
    })
    const row = res.entries.find((e) => e.name === 'Plain Rb')
    expect(row).toBeDefined()
    expect(row!.nflDraftProjectionSplits).toBeDefined()
    expect(row!.nflDraftProjectionSplits).toEqual(emptyNflDraftProjectionSplits())

    const s = row!.nflDraftProjectionSplits!
    const numericLeaves: number[] = []
    const walk = (v: unknown) => {
      if (v === null || v === undefined) return
      if (typeof v === 'number') {
        numericLeaves.push(v)
        return
      }
      if (typeof v === 'object' && !Array.isArray(v)) {
        for (const x of Object.values(v as Record<string, unknown>)) walk(x)
      }
    }
    walk(s)
    expect(numericLeaves.length).toBe(0)
  })
})
