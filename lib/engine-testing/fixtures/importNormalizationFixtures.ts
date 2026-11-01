/**
 * Minimal `NormalizedImportResult` builders for import normalization + bundle tests (no I/O).
 */

import type {
  ImportCoverage,
  NormalizedImportResult,
  NormalizedRoster,
} from '@/lib/league-import/types'

function coverageFull(): ImportCoverage {
  const full = { state: 'full' as const }
  return {
    leagueSettings: full,
    currentRosters: full,
    historicalRosterSnapshots: full,
    scoringSettings: full,
    playoffSettings: full,
    currentStandings: full,
    currentSchedule: full,
    draftHistory: full,
    tradeHistory: full,
    previousSeasons: full,
    playerIdentityMap: full,
  }
}

function stubRoster(i: number): NormalizedRoster {
  const id = `t${i}`
  return {
    source_team_id: id,
    source_manager_id: `m${i}`,
    owner_name: `Owner ${i}`,
    team_name: `Team ${i}`,
    avatar_url: null,
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    player_ids: [],
    starter_ids: [],
  }
}

export function buildMinimalNormalizedImport(overrides?: Partial<NormalizedImportResult>): NormalizedImportResult {
  const leagueSize = 12
  const rosters: NormalizedRoster[] = Array.from({ length: leagueSize }, (_, i) => stubRoster(i + 1))
  const base: NormalizedImportResult = {
    source: {
      source_provider: 'sleeper',
      source_league_id: 'import-fixture-league',
      imported_at: new Date().toISOString(),
    },
    league: {
      name: 'Import Fixture',
      sport: 'nfl',
      season: 2026,
      leagueSize,
      rosterSize: 16,
      scoring: 'half ppr',
      isDynasty: false,
    },
    rosters,
    scoring: {
      scoring_format: 'half ppr',
      rules: [{ stat_key: 'reception', points_value: 0.5 }],
    },
    schedule: [],
    draft_picks: [],
    transactions: [],
    standings: [],
    player_map: {},
    coverage: coverageFull(),
  }
  return { ...base, ...overrides, league: { ...base.league, ...overrides?.league }, source: { ...base.source, ...overrides?.source } }
}

/** Signals dynasty + devy taxi for heuristic concept tests. */
export function buildDynastyDevyImportFixture(): NormalizedImportResult {
  const r = buildMinimalNormalizedImport({
    league: {
      name: 'Dynasty Devy Import',
      sport: 'nfl',
      season: 2026,
      leagueSize: 12,
      rosterSize: 30,
      scoring: 'ppr',
      isDynasty: true,
    },
  })
  r.rosters = r.rosters.map((roster, idx) =>
    idx === 0 ? { ...roster, taxi_ids: ['p1', 'p2'] } : roster,
  )
  return r
}

/** Guillotine-style name/signals for concept inference. */
export function buildGuillotineImportFixture(): NormalizedImportResult {
  return buildMinimalNormalizedImport({
    league: {
      name: 'Guilly League',
      sport: 'nfl',
      season: 2026,
      leagueSize: 18,
      rosterSize: 16,
      scoring: 'standard',
      isDynasty: false,
    },
  })
}
