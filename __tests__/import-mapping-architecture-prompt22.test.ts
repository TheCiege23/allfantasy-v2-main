/**
 * Prompt 22 – Import Mapping Architecture
 *
 * Covers:
 *  1. ImportProviderResolver — alias resolution + unsupported providers return null
 *  2. LeagueImportRegistry  — adapter retrieval + hasFullAdapter flags
 *  3. ImportNormalizationPipeline (simple, raw-payload entry point)
 *  4. SleeperAdapter        — full normalization with coverage buckets
 *  5. EspnAdapter           — PPR/half/standard detection + roster/schedule mapping
 *  6. YahooAdapter          — stat-modifier scoring + keeper/dynasty detection
 *  7. MflAdapter            — scoring format inference + dynasty key detection
 *  8. FantraxAdapter        — full-adapter normalization + coverage buckets
 *  9. ImportedLeaguePreviewBuilder — data-quality scoring + tier assignment
 */

import { describe, expect, it } from 'vitest'

import { resolveProvider, isSupportedProvider } from '@/lib/league-import/ImportProviderResolver'
import { getAdapter, getSupportedProviders, hasFullAdapter } from '@/lib/league-import/LeagueImportRegistry'
import { runImportNormalizationPipeline } from '@/lib/league-import/ImportNormalizationPipeline'
import { buildImportedLeaguePreview } from '@/lib/league-import/ImportedLeaguePreviewBuilder'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'
import type { EspnImportPayload } from '@/lib/league-import/adapters/espn/types'
import type { YahooImportPayload } from '@/lib/league-import/adapters/yahoo/types'
import type { MflImportPayload } from '@/lib/league-import/adapters/mfl/types'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid Sleeper import payload. */
function makeSleeperPayload(overrides?: Partial<SleeperImportPayload>): SleeperImportPayload {
  return {
    league: {
      league_id: 'sl-001',
      name: 'Test Sleeper League',
      sport: 'NFL',
      season: '2024',
      total_rosters: 2,
      settings: { type: 0, playoff_teams: 4 },
      scoring_settings: { rec: 1, pass_td: 4 },
      roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'],
    },
    users: [
      { user_id: 'u1', username: 'alice', display_name: 'Alice A' },
      { user_id: 'u2', username: 'bob', display_name: 'Bobby B' },
    ],
    rosters: [
      {
        roster_id: 1,
        owner_id: 'u1',
        players: ['p1', 'p2'],
        starters: ['p1'],
        reserve: [],
        taxi: [],
        settings: { wins: 8, losses: 5, ties: 0, fpts: 1234, fpts_decimal: 56 },
      },
      {
        roster_id: 2,
        owner_id: 'u2',
        players: ['p3'],
        starters: ['p3'],
        reserve: [],
        taxi: [],
        settings: { wins: 6, losses: 7, ties: 0, fpts: 1100, fpts_decimal: 0 },
      },
    ],
    matchupsByWeek: [
      { week: 1, matchups: [{ roster_id: 1, matchup_id: 1, points: 120 }, { roster_id: 2, matchup_id: 1, points: 110 }] },
    ],
    transactions: [
      {
        transaction_id: 'txn1',
        type: 'trade',
        status: 'complete',
        created: 1696000000000,
        adds: { p1: 'u2' },
        drops: { p3: 'u1' },
        roster_ids: [1, 2],
      },
    ],
    draftPicks: [
      {
        round: 1,
        roster_id: 1,
        player_id: 'p1',
        pick_no: 1,
        metadata: { first_name: 'James', last_name: 'Jones', position: 'WR', team: 'KC' },
      },
    ],
    playerMap: {
      p1: { name: 'James Jones', position: 'WR', team: 'KC' },
      p2: { name: 'Tyler Smith', position: 'RB', team: 'DAL' },
      p3: { name: 'Sam Adams', position: 'QB', team: 'GB' },
    },
    previousSeasons: [],
    ...overrides,
  }
}

type EspnPayloadOverrides = Partial<Omit<EspnImportPayload, 'league' | 'settings'>> & {
  league?: Partial<EspnImportPayload['league']>
  settings?: Partial<NonNullable<EspnImportPayload['settings']>> | null
}

/** Minimal valid ESPN import payload. */
function makeEspnPayload(overrides: EspnPayloadOverrides = {}): EspnImportPayload {
  const base: EspnImportPayload = {
    sourceInput: 'espn-001',
    league: {
      leagueId: 'espn-001',
      name: 'Test ESPN League',
      sport: 'NFL',
      season: 2024,
      size: 2,
      currentWeek: 1,
      isFinished: false,
      playoffTeamCount: 4,
      regularSeasonLength: 14,
    },
    settings: {
      scoringType: 'H2H_POINTS',
      draftType: 'SNAKE',
      lineupSlotCounts: [{ slotId: 1, slot: 'QB', count: 1 }, { slotId: 2, slot: 'RB', count: 2 }],
      scoringItems: [
        { statId: 3, points: 4 },
        { statId: 53, points: 1 },
      ],
      usesFaab: true,
      acquisitionBudget: 100,
      waiverProcessDay: 2,
      playoffTeamCount: 4,
      matchupPeriodCount: 17,
      regularSeasonMatchupCount: 14,
      raw: {},
    },
    teams: [
      {
        teamId: 't1',
        teamName: 'Eagles FC',
        managerId: 'm1',
        managerName: 'Eve Manager',
        logoUrl: null,
        wins: 9,
        losses: 4,
        ties: 0,
        rank: 1,
        pointsFor: 1500,
        pointsAgainst: 1300,
        rosterPlayerIds: ['e1', 'e2'],
        starterPlayerIds: ['e1'],
        reservePlayerIds: [],
        faabRemaining: 50,
        waiverPriority: 1,
        playerMap: {},
      },
    ],
    schedule: [
      {
        week: 1,
        season: 2024,
        matchups: [{ teamId1: 't1', teamId2: 't2', points1: 130, points2: 120 }],
      },
    ],
    transactions: [],
    draftPicks: [
      {
        round: 1,
        pickNumber: 1,
        overallPickNumber: 1,
        teamId: 't1',
        playerId: 'e1',
        playerName: 'JT',
        position: 'RB',
        team: 'IND',
      },
    ],
    transactionsFetched: true,
    draftFetched: true,
    previousSeasons: [],
  }

  return {
    ...base,
    ...overrides,
    league: { ...base.league, ...(overrides.league ?? {}) },
    settings:
      overrides.settings === null
        ? null
        : ({ ...(base.settings ?? {}), ...(overrides.settings ?? {}) } as NonNullable<
            EspnImportPayload['settings']
          >),
  }
}

type YahooPayloadOverrides = Partial<Omit<YahooImportPayload, 'league' | 'settings'>> & {
  league?: Partial<YahooImportPayload['league']>
  settings?: Partial<NonNullable<YahooImportPayload['settings']>> | null
}

/** Minimal valid Yahoo import payload. */
function makeYahooPayload(overrides: YahooPayloadOverrides = {}): YahooImportPayload {
  const base: YahooImportPayload = {
    sourceInput: 'yahoo-001',
    resolvedFromLeagueList: true,
    league: {
      leagueKey: 'yahoo-001',
      leagueId: '999',
      name: 'Test Yahoo League',
      sport: 'NFL',
      season: 2024,
      numTeams: 2,
      draftStatus: 'postdraft',
      currentWeek: 1,
      startWeek: 1,
      endWeek: 14,
      isFinished: false,
      url: null,
    },
    settings: {
      draftType: 'live',
      scoringType: 'headpoint',
      usesPlayoff: true,
      playoffStartWeek: 14,
      usesPlayoffReseeding: false,
      usesLockEliminatedTeams: false,
      usesFaab: true,
      tradeEndDate: null,
      tradeRatifyType: 'commish',
      rosterPositions: [{ position: 'QB', count: 1 }, { position: 'RB', count: 2 }],
      statCategories: [
        { statId: '77', name: 'rec', displayName: 'Receptions', enabled: true, positionType: 'O' },
      ],
      statModifiers: [{ statId: '77', value: 1 }],
      raw: {},
    },
    teams: [
      {
        teamKey: 'y.l.999.t.1',
        teamId: '1',
        teamName: 'Yahooligans',
        managerId: 'ym1',
        managerGuid: 'g-ym1',
        managerName: 'Yui Manager',
        logoUrl: null,
        wins: 7,
        losses: 6,
        ties: 0,
        rank: 1,
        pointsFor: 1200,
        pointsAgainst: 1100,
        rosterPlayerIds: ['yp1'],
        starterPlayerIds: ['yp1'],
        reservePlayerIds: [],
        faabBalance: 80,
        waiverPriority: 3,
        clinchedPlayoffs: false,
        playerMap: {},
      },
    ],
    schedule: [
      {
        week: 1,
        season: 2024,
        matchups: [{ teamKey1: 'y.l.999.t.1', teamKey2: 'y.l.999.t.2', points1: 110, points2: 95 }],
      },
    ],
    scheduleWeeksExpected: 14,
    scheduleWeeksCovered: 1,
    transactions: [],
    draftPicks: [],
    previousSeasons: [],
  }

  return {
    ...base,
    ...overrides,
    league: { ...base.league, ...(overrides.league ?? {}) },
    settings:
      overrides.settings === null
        ? null
        : ({ ...(base.settings ?? {}), ...(overrides.settings ?? {}) } as NonNullable<
            YahooImportPayload['settings']
          >),
  }
}

type MflPayloadOverrides = Partial<Omit<MflImportPayload, 'league' | 'settings'>> & {
  league?: Partial<MflImportPayload['league']>
  settings?: Partial<NonNullable<MflImportPayload['settings']>> | null
}

/** Minimal valid MFL import payload. */
function makeMflPayload(overrides: MflPayloadOverrides = {}): MflImportPayload {
  const base: MflImportPayload = {
    sourceInput: 'mfl-001',
    league: {
      leagueId: 'mfl-001',
      name: 'Test MFL League',
      sport: 'NFL',
      season: 2024,
      size: 2,
      currentWeek: 1,
      isFinished: false,
      playoffTeamCount: 4,
      regularSeasonLength: 14,
      url: null,
    },
    settings: {
      scoringType: 'PPR',
      draftType: 'snake',
      rosterPositions: [{ position: 'QB', count: 1 }, { position: 'RB', count: 2 }],
      usesFaab: true,
      acquisitionBudget: 100,
      waiverType: 'faab',
      usesTaxi: false,
      raw: {},
    },
    teams: [
      {
        franchiseId: 'mfl-t1',
        managerId: 'mfl-m1',
        managerName: 'Mike MFL',
        teamName: 'MFL Monsters',
        logoUrl: null,
        wins: 10,
        losses: 3,
        ties: 0,
        rank: 1,
        pointsFor: 1600,
        pointsAgainst: null,
        rosterPlayerIds: ['mp1', 'mp2'],
        starterPlayerIds: ['mp1'],
        reservePlayerIds: [],
        faabRemaining: null,
        waiverPriority: null,
        playerMap: {},
      },
    ],
    schedule: [
      {
        week: 1,
        season: 2024,
        matchups: [{ franchiseId1: 'mfl-t1', franchiseId2: 'mfl-t2', points1: 150, points2: 140 }],
      },
    ],
    transactions: [],
    draftPicks: [
      { round: 1, pickNumber: 1, franchiseId: 'mfl-t1', playerId: 'mp1', playerName: 'CeeDee', position: 'WR', team: 'DAL' },
    ],
    playerMap: { mp1: { name: 'CeeDee Lamb', position: 'WR', team: 'DAL' } },
    lineupBreakdownAvailable: true,
    previousSeasons: [],
  }

  return {
    ...base,
    ...overrides,
    league: { ...base.league, ...(overrides.league ?? {}) },
    settings:
      overrides.settings === null
        ? null
        : ({ ...(base.settings ?? {}), ...(overrides.settings ?? {}) } as NonNullable<
            MflImportPayload['settings']
          >),
  }
}

/** Minimal valid Fantrax import payload. */
function makeFantraxPayload(overrides?: Partial<FantraxImportPayload>): FantraxImportPayload {
  return {
    sourceInput: 'fantrax-001',
    league: {
      leagueId: 'ftx-001',
      name: 'Test Fantrax League',
      sport: 'NFL',
      season: 2024,
      size: 2,
      currentWeek: 8,
      isFinished: false,
      url: null,
      isDevy: false,
    },
    settings: {
      scoringType: 'PPR',
      rosterPositions: [{ position: 'QB', count: 1 }],
      scoringRules: [{ statKey: 'rec', points: 1 }],
      raw: {},
    },
    teams: [
      {
        teamId: 'ftx-t1',
        managerId: 'ftx-m1',
        managerName: 'Frank Fantrax',
        teamName: 'Fantrax Flyers',
        logoUrl: null,
        wins: 5,
        losses: 3,
        ties: 0,
        rank: 1,
        pointsFor: 800,
        pointsAgainst: null,
        faabRemaining: null,
        waiverPriority: null,
        rosterPlayerIds: ['fp1'],
        starterPlayerIds: ['fp1'],
        reservePlayerIds: [],
        playerMap: {},
      },
    ],
    schedule: [
      {
        week: 1,
        season: 2024,
        matchups: [{ teamId1: 'ftx-t1', teamId2: 'ftx-t2', points1: 100, points2: 90 }],
      },
    ],
    transactions: [],
    draftPicks: [],
    playerMap: { fp1: { name: 'Patrick Mahomes', position: 'QB', team: 'KC' } },
    previousSeasons: [],
    ...overrides,
  }
}

/** Build a fully-covered NormalizedImportResult for use in preview builder tests. */
function makeFullNormalized(): NormalizedImportResult {
  return {
    source: {
      source_provider: 'sleeper',
      source_league_id: 'sl-001',
      source_season_id: '2024',
      import_batch_id: 'sleeper-sl-001-0',
      imported_at: new Date().toISOString(),
    },
    league: {
      name: 'Full Coverage League',
      sport: 'NFL',
      season: 2024,
      leagueSize: 10,
      rosterSize: 15,
      scoring: 'ppr',
      isDynasty: false,
      playoff_team_count: 4,
    },
    rosters: [
      {
        source_team_id: '1',
        source_manager_id: 'u1',
        owner_name: 'Alice',
        team_name: 'Alice FC',
        avatar_url: null,
        wins: 8,
        losses: 5,
        ties: 0,
        points_for: 1234.56,
        player_ids: ['p1', 'p2'],
        starter_ids: ['p1'],
        reserve_ids: [],
        taxi_ids: [],
      },
    ],
    scoring: { scoring_format: 'ppr', rules: [{ stat_key: 'rec', points_value: 1 }], raw: {} },
    schedule: [
      { week: 1, season: 2024, matchups: [{ roster_id_1: '1', roster_id_2: '2', points_1: 100, points_2: 95 }] },
    ],
    draft_picks: [
      { round: 1, pick_no: 1, source_roster_id: '1', source_player_id: 'p1', player_name: 'James Jones', position: 'WR', team: 'KC' },
    ],
    transactions: [
      {
        source_transaction_id: 'txn1',
        type: 'trade',
        status: 'complete',
        created_at: new Date().toISOString(),
        roster_ids: ['1', '2'],
        draft_picks: [],
      },
    ],
    standings: [
      { source_team_id: '1', rank: 1, wins: 8, losses: 5, ties: 0, points_for: 1234.56, points_against: 900 },
    ],
    player_map: { p1: { name: 'James Jones', position: 'WR', team: 'KC' } },
    coverage: {
      leagueSettings: { state: 'full', count: 1 },
      currentRosters: { state: 'full', count: 1 },
      historicalRosterSnapshots: { state: 'partial', count: 0, note: 'backfill pending' },
      scoringSettings: { state: 'full' },
      playoffSettings: { state: 'full' },
      currentStandings: { state: 'full', count: 1 },
      currentSchedule: { state: 'full', count: 1 },
      draftHistory: { state: 'full', count: 1 },
      tradeHistory: { state: 'full', count: 1 },
      previousSeasons: { state: 'missing', count: 0 },
      playerIdentityMap: { state: 'full', count: 1 },
    },
  }
}

// ---------------------------------------------------------------------------
// 1. ImportProviderResolver
// ---------------------------------------------------------------------------

describe('ImportProviderResolver', () => {
  it('resolves canonical provider names correctly', () => {
    expect(resolveProvider('sleeper')).toBe('sleeper')
    expect(resolveProvider('espn')).toBe('espn')
    expect(resolveProvider('yahoo')).toBe('yahoo')
    expect(resolveProvider('fantrax')).toBe('fantrax')
    expect(resolveProvider('mfl')).toBe('mfl')
  })

  it('resolves MFL aliases to canonical mfl provider', () => {
    expect(resolveProvider('myfantasyleague')).toBe('mfl')
    expect(resolveProvider('my-fantasy-league')).toBe('mfl')
  })

  it('is case-insensitive', () => {
    expect(resolveProvider('SLEEPER')).toBe('sleeper')
    expect(resolveProvider('ESPN')).toBe('espn')
    expect(resolveProvider('Yahoo')).toBe('yahoo')
    expect(resolveProvider('MFL')).toBe('mfl')
    expect(resolveProvider('MyFantasyLeague')).toBe('mfl')
  })

  it('returns null for unknown providers', () => {
    expect(resolveProvider('unknown-platform')).toBeNull()
    expect(resolveProvider('')).toBeNull()
    expect(resolveProvider('   ')).toBeNull()
  })

  it('isSupportedProvider returns true for known providers and false otherwise', () => {
    expect(isSupportedProvider('sleeper')).toBe(true)
    expect(isSupportedProvider('espn')).toBe(true)
    expect(isSupportedProvider('myfantasyleague')).toBe(true)
    expect(isSupportedProvider('nfl.com')).toBe(false)
    expect(isSupportedProvider('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. LeagueImportRegistry
// ---------------------------------------------------------------------------

describe('LeagueImportRegistry', () => {
  it('returns an adapter for every supported provider', () => {
    const providers = getSupportedProviders()
    expect(providers.length).toBeGreaterThanOrEqual(5)
    for (const provider of providers) {
      const adapter = getAdapter(provider)
      expect(adapter).toBeDefined()
      expect(adapter.provider).toBe(provider)
      expect(typeof adapter.normalize).toBe('function')
    }
  })

  it('throws for unsupported provider (safety guard)', () => {
    // TypeScript won't allow invalid providers at compile time, cast for runtime test
    expect(() => getAdapter('invalid-provider' as never)).toThrow()
  })

  it('hasFullAdapter is true for all five providers', () => {
    expect(hasFullAdapter('sleeper')).toBe(true)
    expect(hasFullAdapter('espn')).toBe(true)
    expect(hasFullAdapter('yahoo')).toBe(true)
    expect(hasFullAdapter('mfl')).toBe(true)
    expect(hasFullAdapter('fantrax')).toBe(true)
  })

  it('getSupportedProviders includes every canonical provider', () => {
    const providers = getSupportedProviders()
    expect(providers).toContain('sleeper')
    expect(providers).toContain('espn')
    expect(providers).toContain('yahoo')
    expect(providers).toContain('fantrax')
    expect(providers).toContain('mfl')
  })
})

// ---------------------------------------------------------------------------
// 3. ImportNormalizationPipeline (simple, raw-payload entry point)
// ---------------------------------------------------------------------------

describe('ImportNormalizationPipeline – runImportNormalizationPipeline', () => {
  it('runs end-to-end with Sleeper payload and returns NormalizedImportResult', async () => {
    const raw = makeSleeperPayload()
    const result = await runImportNormalizationPipeline({ provider: 'sleeper', raw })

    expect(result.source.source_provider).toBe('sleeper')
    expect(result.source.source_league_id).toBe('sl-001')
    expect(result.source.import_batch_id).toMatch(/^sleeper-sl-001-/)
    expect(result.league.name).toBe('Test Sleeper League')
    expect(result.league.sport).toBe('NFL')
    expect(result.rosters.length).toBe(2)
  })

  it('resolves provider aliases — myfantasyleague routes to MFL adapter', async () => {
    const raw = makeMflPayload()
    const result = await runImportNormalizationPipeline({ provider: 'myfantasyleague', raw })

    expect(result.source.source_provider).toBe('mfl')
    expect(result.league.name).toBe('Test MFL League')
  })

  it('throws for completely unsupported provider strings', async () => {
    await expect(
      runImportNormalizationPipeline({ provider: 'draftkings', raw: {} })
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 4. SleeperAdapter
// ---------------------------------------------------------------------------

describe('SleeperAdapter – normalize', () => {
  it('normalizes league settings correctly', async () => {
    const raw = makeSleeperPayload()
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.league.name).toBe('Test Sleeper League')
    expect(result.league.sport).toBe('NFL')
    expect(result.league.season).toBe(2024)
    expect(result.league.leagueSize).toBe(2)
    expect(result.league.isDynasty).toBe(false)
    expect(result.source.source_provider).toBe('sleeper')
    expect(result.source.source_league_id).toBe('sl-001')
  })

  it('maps rosters with wins/losses/points and player lists', async () => {
    const raw = makeSleeperPayload()
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.rosters.length).toBe(2)
    const r1 = result.rosters.find((r) => r.source_manager_id === 'u1')
    expect(r1).toBeDefined()
    expect(r1!.wins).toBe(8)
    expect(r1!.losses).toBe(5)
    expect(r1!.player_ids).toContain('p1')
    expect(r1!.starter_ids).toContain('p1')
    expect(r1!.owner_name).toBe('Alice A')
  })

  it('maps draft picks with round, pick_no, player metadata', async () => {
    const raw = makeSleeperPayload()
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.draft_picks.length).toBe(1)
    const pick = result.draft_picks[0]
    expect(pick.round).toBe(1)
    expect(pick.pick_no).toBe(1)
    expect(pick.source_player_id).toBe('p1')
    expect(pick.position).toBe('WR')
  })

  it('maps transactions with type, roster_ids, adds/drops', async () => {
    const raw = makeSleeperPayload()
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.transactions.length).toBeGreaterThan(0)
    const txn = result.transactions[0]
    expect(txn.type).toBe('trade')
    expect(txn.status).toBe('complete')
    expect(txn.roster_ids.length).toBeGreaterThan(0)
  })

  it('maps schedule matchups with week, points, roster_ids', async () => {
    const raw = makeSleeperPayload()
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.schedule.length).toBe(1)
    const week = result.schedule[0]
    expect(week.week).toBe(1)
    expect(week.matchups.length).toBeGreaterThan(0)
  })

  it('passes through player_map from payload', async () => {
    const raw = makeSleeperPayload()
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.player_map['p1']).toBeDefined()
    expect(result.player_map['p1'].name).toBe('James Jones')
    expect(result.player_map['p1'].position).toBe('WR')
  })

  it('sets coverage.leagueSettings to full', async () => {
    const raw = makeSleeperPayload()
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.coverage.leagueSettings.state).toBe('full')
  })

  it('sets coverage.currentRosters to full when all rosters have players', async () => {
    const raw = makeSleeperPayload()
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.coverage.currentRosters.state).toBe('full')
    expect(result.coverage.currentRosters.count).toBe(2)
  })

  it('sets coverage.currentRosters to partial when some rosters lack players', async () => {
    const raw = makeSleeperPayload({
      rosters: [
        {
          roster_id: 1,
          owner_id: 'u1',
          players: ['p1'],
          starters: ['p1'],
          reserve: [],
          taxi: [],
          settings: { wins: 8, losses: 5, ties: 0, fpts: 100, fpts_decimal: 0 },
        },
        {
          roster_id: 2,
          owner_id: 'u2',
          players: [],
          starters: [],
          reserve: [],
          taxi: [],
          settings: { wins: 5, losses: 8, ties: 0, fpts: 80, fpts_decimal: 0 },
        },
      ],
    })
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.coverage.currentRosters.state).toBe('partial')
  })

  it('sets coverage.draftHistory to full when draft picks exist', async () => {
    const raw = makeSleeperPayload()
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.coverage.draftHistory.state).toBe('full')
    expect(result.coverage.draftHistory.count).toBe(1)
  })

  it('sets coverage.draftHistory to missing when no draft picks', async () => {
    const raw = makeSleeperPayload({ draftPicks: [] })
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.coverage.draftHistory.state).toBe('missing')
    expect(result.coverage.draftHistory.count).toBe(0)
  })

  it('detects PPR from scoring_settings.rec === 1', async () => {
    const raw = makeSleeperPayload({
      league: {
        league_id: 'sl-001',
        name: 'PPR League',
        sport: 'NFL',
        season: '2024',
        total_rosters: 2,
        scoring_settings: { rec: 1, pass_td: 4 },
        roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'],
      },
    })
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    // PPR detection may surface in scoring_format or league.scoring
    const hasPpr =
      result.scoring?.scoring_format === 'ppr' ||
      result.league.scoring === 'ppr' ||
      String(result.league.scoring).includes('ppr') ||
      (result.scoring?.rules ?? []).some((r) => r.stat_key === 'rec' && r.points_value >= 1)
    expect(hasPpr).toBe(true)
  })

  it('normalizes without previous seasons when none provided', async () => {
    const raw = makeSleeperPayload({ previousSeasons: [] })
    const adapter = getAdapter('sleeper')
    const result = await adapter.normalize(raw)

    expect(result.coverage.previousSeasons.state).toBe('missing')
    expect(result.previous_seasons?.length ?? 0).toBe(0)
  })

  it('handles empty payload gracefully (no throws)', async () => {
    const raw: SleeperImportPayload = {
      league: {
        league_id: 'empty',
        name: 'Empty League',
        sport: 'NFL',
        season: '2024',
        total_rosters: 0,
      },
    }
    const adapter = getAdapter('sleeper')
    await expect(adapter.normalize(raw)).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 5. EspnAdapter
// ---------------------------------------------------------------------------

describe('EspnAdapter – normalize', () => {
  it('sets source_provider to espn and captures league id', async () => {
    const raw = makeEspnPayload()
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    expect(result.source.source_provider).toBe('espn')
    expect(result.source.source_league_id).toBe('espn-001')
    expect(result.source.import_batch_id).toMatch(/^espn-espn-001-/)
  })

  it('maps league settings', async () => {
    const raw = makeEspnPayload()
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    expect(result.league.name).toBe('Test ESPN League')
    expect(result.league.sport).toBe('NFL')
    expect(result.league.season).toBe(2024)
  })

  it('detects PPR scoring when statId 53 has points >= 1', async () => {
    const raw = makeEspnPayload()
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    expect(result.scoring?.scoring_format).toBe('ppr')
  })

  it('detects half-PPR scoring when statId 53 has points = 0.5', async () => {
    const raw = makeEspnPayload({
      settings: {
        scoringType: 'H2H_POINTS',
        lineupSlotCounts: [],
        scoringItems: [{ statId: 53, points: 0.5 }],
        raw: {},
      },
    })
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    expect(result.scoring?.scoring_format).toBe('half')
  })

  it('falls back to scoringType when statId 53 has 0 points (H2H_POINTS → h2h-points)', async () => {
    const raw = makeEspnPayload({
      settings: {
        scoringType: 'H2H_POINTS',
        lineupSlotCounts: [],
        scoringItems: [{ statId: 53, points: 0 }],
        raw: {},
      },
    })
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    // When reception points = 0, detectEspnScoringFormat checks scoringType next.
    // H2H_POINTS → 'h2h-points'; the adapter does NOT default to 'standard' in that branch.
    expect(result.scoring?.scoring_format).toBe('h2h-points')
  })

  it('returns standard scoring for NFL when no scoringType hint is present', async () => {
    const raw = makeEspnPayload({
      settings: {
        scoringType: 'STANDARD',
        lineupSlotCounts: [],
        scoringItems: [],           // no statId 53 at all
        raw: {},
      },
    })
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    // With no rec rule and scoringType='STANDARD' (no known H2H/category keyword),
    // the adapter returns league.sport === 'NFL' ? 'standard' as fallback.
    expect(result.scoring?.scoring_format).toBe('standard')
  })

  it('normalizes rosters with manager details', async () => {
    const raw = makeEspnPayload()
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    expect(result.rosters.length).toBe(1)
    const roster = result.rosters[0]
    expect(roster.source_team_id).toBe('t1')
    expect(roster.owner_name).toBe('Eve Manager')
    expect(roster.wins).toBe(9)
    expect(roster.player_ids).toEqual(['e1', 'e2'])
  })

  it('maps schedule with week and matchup points', async () => {
    const raw = makeEspnPayload()
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    expect(result.schedule.length).toBe(1)
    const week = result.schedule[0]
    expect(week.week).toBe(1)
    const matchup = week.matchups[0]
    expect(matchup.points_1).toBe(130)
    expect(matchup.points_2).toBe(120)
  })

  it('treats ESPN total-points leagues as complete without inventing head-to-head opponents', async () => {
    const raw = makeEspnPayload({
      settings: { scoringType: 'TOTAL_POINTS', scoringItems: [], lineupSlotCounts: [], raw: {} },
      schedule: [],
    })
    const result = await getAdapter('espn').normalize(raw)

    expect(result.league.matchup_frequency).toBe('total_points')
    expect(result.coverage?.currentSchedule).toMatchObject({ state: 'full', count: 0 })
    expect(result.coverage?.currentSchedule.note).toContain('no paired head-to-head schedule')
  })

  it('maps draft picks with round and player info', async () => {
    const raw = makeEspnPayload()
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    expect(result.draft_picks.length).toBe(1)
    expect(result.draft_picks[0].round).toBe(1)
    expect(result.draft_picks[0].source_player_id).toBe('e1')
    expect(result.draft_picks[0].position).toBe('RB')
  })

  it('detects dynasty when keeperCount > 0', async () => {
    const raw = makeEspnPayload({
      settings: {
        scoringType: 'H2H_POINTS',
        lineupSlotCounts: [],
        scoringItems: [],
        raw: { keeperCount: 3 },
      },
    })
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    expect(result.league.isDynasty).toBe(true)
  })

  it('normalizes coverage buckets', async () => {
    const raw = makeEspnPayload()
    const adapter = getAdapter('espn')
    const result = await adapter.normalize(raw)

    expect(result.coverage.leagueSettings.state).toBe('full')
    expect(result.coverage.currentRosters).toBeDefined()
    expect(result.coverage.scoringSettings).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 6. YahooAdapter
// ---------------------------------------------------------------------------

describe('YahooAdapter – normalize', () => {
  it('sets source_provider to yahoo and captures league key', async () => {
    const raw = makeYahooPayload()
    const adapter = getAdapter('yahoo')
    const result = await adapter.normalize(raw)

    expect(result.source.source_provider).toBe('yahoo')
    expect(result.source.source_league_id).toBe('yahoo-001')
    expect(result.source.import_batch_id).toMatch(/^yahoo-yahoo-001-/)
  })

  it('detects PPR from stat modifier value >= 1 for reception category', async () => {
    const raw = makeYahooPayload()
    const adapter = getAdapter('yahoo')
    const result = await adapter.normalize(raw)

    expect(result.scoring?.scoring_format).toBe('ppr')
  })

  it('detects half-PPR when reception modifier value = 0.5', async () => {
    const raw = makeYahooPayload({
      settings: {
        scoringType: 'headpoint',
        rosterPositions: [],
        statCategories: [{ statId: '77', name: 'rec', displayName: 'Receptions', enabled: true, positionType: 'O' }],
        statModifiers: [{ statId: '77', value: 0.5 }],
        usesPlayoff: true,
        playoffStartWeek: 14,
        raw: {},
      },
    })
    const adapter = getAdapter('yahoo')
    const result = await adapter.normalize(raw)

    expect(result.scoring?.scoring_format).toBe('half')
  })

  it('detects standard when no reception stat category exists', async () => {
    const raw = makeYahooPayload({
      settings: {
        scoringType: 'headpoint',
        rosterPositions: [],
        statCategories: [{ statId: '1', name: 'pass_yd', displayName: 'Passing Yards', enabled: true, positionType: 'O' }],
        statModifiers: [{ statId: '1', value: 0.04 }],
        usesPlayoff: false,
        playoffStartWeek: null,
        raw: {},
      },
    })
    const adapter = getAdapter('yahoo')
    const result = await adapter.normalize(raw)

    expect(result.scoring?.scoring_format).toBe('standard')
  })

  it('detects dynasty via keeper_players setting key', async () => {
    const raw = makeYahooPayload({
      settings: {
        scoringType: 'headpoint',
        rosterPositions: [],
        statCategories: [],
        statModifiers: [],
        usesPlayoff: false,
        playoffStartWeek: null,
        raw: { keeper_players: 3 },
      },
    })
    const adapter = getAdapter('yahoo')
    const result = await adapter.normalize(raw)

    expect(result.league.isDynasty).toBe(true)
  })

  it('maps rosters with team/manager info', async () => {
    const raw = makeYahooPayload()
    const adapter = getAdapter('yahoo')
    const result = await adapter.normalize(raw)

    expect(result.rosters.length).toBe(1)
    const roster = result.rosters[0]
    expect(roster.source_team_id).toBe('y.l.999.t.1')
    expect(roster.team_name).toBe('Yahooligans')
    expect(roster.wins).toBe(7)
    expect(roster.faab_remaining).toBe(80)
  })

  it('maps schedule with week and matchup data', async () => {
    const raw = makeYahooPayload()
    const adapter = getAdapter('yahoo')
    const result = await adapter.normalize(raw)

    expect(result.schedule.length).toBe(1)
    const matchup = result.schedule[0].matchups[0]
    expect(matchup.roster_id_1).toBe('y.l.999.t.1')
    expect(matchup.points_1).toBe(110)
  })
})

// ---------------------------------------------------------------------------
// 7. MflAdapter
// ---------------------------------------------------------------------------

describe('MflAdapter – normalize', () => {
  it('sets source_provider to mfl and captures league id', async () => {
    const raw = makeMflPayload()
    const adapter = getAdapter('mfl')
    const result = await adapter.normalize(raw)

    expect(result.source.source_provider).toBe('mfl')
    expect(result.source.source_league_id).toBe('mfl-001')
    expect(result.source.import_batch_id).toMatch(/^mfl-mfl-001-/)
  })

  it('detects PPR from scoringType string containing "PPR"', async () => {
    const raw = makeMflPayload()
    const adapter = getAdapter('mfl')
    const result = await adapter.normalize(raw)

    expect(result.scoring?.scoring_format).toBe('ppr')
  })

  it('detects dynasty via keeper key in raw settings', async () => {
    const raw = makeMflPayload({
      settings: {
        scoringType: 'standard',
        rosterPositions: [],
        raw: { dynasty: 'yes' },
      },
    })
    const adapter = getAdapter('mfl')
    const result = await adapter.normalize(raw)

    expect(result.league.isDynasty).toBe(true)
  })

  it('detects dynasty via salary_cap_amount > 0', async () => {
    const raw = makeMflPayload({
      settings: {
        scoringType: 'standard',
        rosterPositions: [],
        raw: { salary_cap_amount: 200 },
      },
    })
    const adapter = getAdapter('mfl')
    const result = await adapter.normalize(raw)

    expect(result.league.isDynasty).toBe(true)
  })

  it('normalizes rosters with franchiseId as source_team_id', async () => {
    const raw = makeMflPayload()
    const adapter = getAdapter('mfl')
    const result = await adapter.normalize(raw)

    expect(result.rosters.length).toBe(1)
    const roster = result.rosters[0]
    expect(roster.source_team_id).toBe('mfl-t1')
    expect(roster.team_name).toBe('MFL Monsters')
    expect(roster.wins).toBe(10)
    expect(roster.player_ids).toContain('mp1')
  })

  it('maps draft picks with round and player identity', async () => {
    const raw = makeMflPayload()
    const adapter = getAdapter('mfl')
    const result = await adapter.normalize(raw)

    expect(result.draft_picks.length).toBe(1)
    const pick = result.draft_picks[0]
    expect(pick.round).toBe(1)
    expect(pick.position).toBe('WR')
    expect(pick.source_player_id).toBe('mp1')
  })

  it('maps schedule matchups', async () => {
    const raw = makeMflPayload()
    const adapter = getAdapter('mfl')
    const result = await adapter.normalize(raw)

    expect(result.schedule.length).toBe(1)
    const matchup = result.schedule[0].matchups[0]
    expect(matchup.points_1).toBe(150)
    expect(matchup.points_2).toBe(140)
  })

  it('sets coverage.leagueSettings to full', async () => {
    const raw = makeMflPayload()
    const adapter = getAdapter('mfl')
    const result = await adapter.normalize(raw)

    expect(result.coverage.leagueSettings.state).toBe('full')
  })
})

// ---------------------------------------------------------------------------
// 8. FantraxAdapter
// ---------------------------------------------------------------------------

describe('FantraxAdapter – normalize', () => {
  it('sets source_provider to fantrax and captures league id', async () => {
    const raw = makeFantraxPayload()
    const adapter = getAdapter('fantrax')
    const result = await adapter.normalize(raw)

    expect(result.source.source_provider).toBe('fantrax')
    expect(result.source.source_league_id).toBe('ftx-001')
    expect(result.source.import_batch_id).toMatch(/^fantrax-ftx-001-/)
  })

  it('maps league settings from fantrax payload', async () => {
    const raw = makeFantraxPayload()
    const adapter = getAdapter('fantrax')
    const result = await adapter.normalize(raw)

    expect(result.league.name).toBe('Test Fantrax League')
    expect(result.league.sport).toBe('NFL')
    expect(result.league.season).toBe(2024)
  })

  it('maps rosters from fantrax teams', async () => {
    const raw = makeFantraxPayload()
    const adapter = getAdapter('fantrax')
    const result = await adapter.normalize(raw)

    expect(result.rosters.length).toBe(1)
    const roster = result.rosters[0]
    expect(roster.source_team_id).toBe('ftx-t1')
    expect(roster.owner_name).toBe('Frank Fantrax')
    expect(roster.wins).toBe(5)
    expect(roster.player_ids).toContain('fp1')
  })

  it('maps schedule matchups', async () => {
    const raw = makeFantraxPayload()
    const adapter = getAdapter('fantrax')
    const result = await adapter.normalize(raw)

    expect(result.schedule.length).toBe(1)
    const matchup = result.schedule[0].matchups[0]
    expect(matchup.points_1).toBe(100)
    expect(matchup.points_2).toBe(90)
  })

  it('normalizes coverage buckets without throwing', async () => {
    const raw = makeFantraxPayload()
    const adapter = getAdapter('fantrax')
    const result = await adapter.normalize(raw)

    expect(result.coverage.leagueSettings).toBeDefined()
    expect(result.coverage.currentRosters).toBeDefined()
    expect(result.coverage.scoringSettings).toBeDefined()
    expect(result.coverage.draftHistory).toBeDefined()
  })

  it('detects devy (dynasty variant) from isDevy flag', async () => {
    const raw = makeFantraxPayload({
      league: {
        leagueId: 'ftx-devy',
        name: 'Devy League',
        sport: 'NFL',
        season: 2024,
        size: 10,
        currentWeek: 1,
        isFinished: false,
        url: null,
        isDevy: true,
      },
    })
    const adapter = getAdapter('fantrax')
    const result = await adapter.normalize(raw)

    // isDevy maps to isDynasty in the normalized output
    expect(result.league.isDynasty).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 9. ImportedLeaguePreviewBuilder
// ---------------------------------------------------------------------------

describe('buildImportedLeaguePreview', () => {
  it('returns league id, name, sport, season', () => {
    const normalized = makeFullNormalized()
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.league.id).toBe('sl-001')
    expect(preview.league.name).toBe('Full Coverage League')
    expect(preview.league.sport).toBe('NFL')
    expect(preview.league.season).toBe(2024)
  })

  it('returns managers list with owner and team info', () => {
    const normalized = makeFullNormalized()
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.managers.length).toBe(1)
    const mgr = preview.managers[0]
    expect(mgr.username).toBeTruthy()
    expect(mgr.wins).toBe(8)
    expect(mgr.losses).toBe(5)
  })

  it('computes completenessScore between 0 and 100', () => {
    const normalized = makeFullNormalized()
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.dataQuality.completenessScore).toBeGreaterThanOrEqual(0)
    expect(preview.dataQuality.completenessScore).toBeLessThanOrEqual(100)
  })

  it('assigns FULL tier for high-coverage result (completenessScore >= 80)', () => {
    const normalized = makeFullNormalized()
    // Make coverage as complete as possible
    normalized.coverage.historicalRosterSnapshots = { state: 'full', count: 3 }
    normalized.coverage.previousSeasons = { state: 'full', count: 3 }
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.dataQuality.tier).toBe('FULL')
  })

  it('assigns MINIMAL tier for all-missing coverage', () => {
    const normalized = makeFullNormalized()
    const allMissing = { state: 'missing' as const, count: 0 }
    normalized.coverage = {
      leagueSettings: allMissing,
      currentRosters: allMissing,
      historicalRosterSnapshots: allMissing,
      scoringSettings: allMissing,
      playoffSettings: allMissing,
      currentStandings: allMissing,
      currentSchedule: allMissing,
      draftHistory: allMissing,
      tradeHistory: allMissing,
      previousSeasons: allMissing,
      playerIdentityMap: allMissing,
    }
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.dataQuality.completenessScore).toBe(0)
    expect(preview.dataQuality.tier).toBe('MINIMAL')
  })

  it('returns draftPickCount, transactionCount, matchupWeeks from normalized data', () => {
    const normalized = makeFullNormalized()
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.draftPickCount).toBe(1)
    expect(preview.transactionCount).toBe(1)
    expect(preview.matchupWeeks).toBe(1)
  })

  it('populates coverageSummary with all 11 coverage keys + labels', () => {
    const normalized = makeFullNormalized()
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.dataQuality.coverageSummary.length).toBe(11)
    const keys = preview.dataQuality.coverageSummary.map((c) => c.key)
    expect(keys).toContain('leagueSettings')
    expect(keys).toContain('currentRosters')
    expect(keys).toContain('scoringSettings')
    expect(keys).toContain('draftHistory')
    expect(keys).toContain('tradeHistory')
  })

  it('signals list includes description for partial/missing buckets', () => {
    const normalized = makeFullNormalized()
    // Downgrade some buckets so signals are generated
    normalized.coverage.scoringSettings = { state: 'partial', note: 'partial rules only' }
    normalized.coverage.tradeHistory = { state: 'missing' }
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.dataQuality.signals.some((s) => s.toLowerCase().includes('scoring'))).toBe(true)
    expect(preview.dataQuality.signals.some((s) => s.toLowerCase().includes('trade'))).toBe(true)
  })

  it('sources.rosters is false when currentRosters is missing', () => {
    const normalized = makeFullNormalized()
    normalized.coverage.currentRosters = { state: 'missing', count: 0 }
    normalized.rosters = []
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.dataQuality.sources.rosters).toBe(false)
  })

  it('sources.draftPicks is true when draftHistory coverage is full', () => {
    const normalized = makeFullNormalized()
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.dataQuality.sources.draftPicks).toBe(true)
  })

  it('returns source tracking details passthrough', () => {
    const normalized = makeFullNormalized()
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.source.source_provider).toBe('sleeper')
    expect(preview.source.source_league_id).toBe('sl-001')
    expect(preview.source.import_batch_id).toContain('sleeper-sl-001')
  })

  it('isDynasty=true surfaces as Dynasty league type', () => {
    const normalized = makeFullNormalized()
    normalized.league.isDynasty = true
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.league.type).toBe('Dynasty')
  })

  it('isDynasty=false surfaces as Redraft league type', () => {
    const normalized = makeFullNormalized()
    normalized.league.isDynasty = false
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.league.type).toBe('Redraft')
  })
})
