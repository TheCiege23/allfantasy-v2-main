/**
 * Controlled Sleeper `NormalizedImportResult` fixtures for the durable-sync tests.
 * Deterministic — no live provider calls. Mirrors the real normalizer's output shape.
 */
import type {
  ImportCoverage,
  ImportCoverageState,
  NormalizedImportResult,
  NormalizedRoster,
} from '@/lib/league-import/types'

export interface FixtureRoster {
  teamId: string
  managerId: string
  ownerName?: string
  teamName?: string
  wins?: number
  losses?: number
  ties?: number
  pointsFor?: number
  pointsAgainst?: number
  players?: string[]
  starters?: string[]
  reserve?: string[]
  taxi?: string[]
  isCommissioner?: boolean
  isOrphan?: boolean
}

function bucket(state: ImportCoverageState): { state: ImportCoverageState } {
  return { state }
}

function buildCoverage(rostersState: ImportCoverageState): ImportCoverage {
  return {
    leagueSettings: bucket('full'),
    currentRosters: bucket(rostersState),
    historicalRosterSnapshots: bucket('missing'),
    scoringSettings: bucket('full'),
    playoffSettings: bucket('full'),
    currentStandings: bucket('full'),
    currentSchedule: bucket('full'),
    draftHistory: bucket('missing'),
    tradeHistory: bucket('missing'),
    previousSeasons: bucket('missing'),
    playerIdentityMap: bucket('full'),
  }
}

export function makeSleeperNormalized(opts?: {
  leagueId?: string
  season?: number
  name?: string
  status?: string
  scoring?: string
  rosters?: FixtureRoster[]
  rostersCoverage?: ImportCoverageState
  tradedPicks?: Array<{ season: number; round: number; original: string; owner: string }>
  previousLeagueId?: string
}): NormalizedImportResult {
  const leagueId = opts?.leagueId ?? '111'
  const season = opts?.season ?? 2025
  const fixtureRosters: FixtureRoster[] =
    opts?.rosters ?? [
      { teamId: '1', managerId: 'u1', ownerName: 'Alice', teamName: 'Alpha', wins: 2, losses: 1, ties: 0, pointsFor: 300, players: ['p1', 'p2', 'p3', 'p4'], starters: ['p1', 'p2'], reserve: [], taxi: [], isCommissioner: true },
      { teamId: '2', managerId: 'u2', ownerName: 'Bob', teamName: 'Bravo', wins: 1, losses: 2, ties: 0, pointsFor: 250, players: ['p5', 'p6', 'p7'], starters: ['p5'], reserve: [], taxi: [] },
    ]

  const rosters: NormalizedRoster[] = fixtureRosters.map((r) => ({
    source_team_id: r.teamId,
    source_manager_id: r.managerId,
    owner_name: r.ownerName ?? `Owner ${r.teamId}`,
    team_name: r.teamName ?? `Team ${r.teamId}`,
    avatar_url: null,
    is_commissioner: Boolean(r.isCommissioner),
    is_co_commissioner: false,
    is_orphan: Boolean(r.isOrphan),
    wins: r.wins ?? 0,
    losses: r.losses ?? 0,
    ties: r.ties ?? 0,
    points_for: r.pointsFor ?? 0,
    points_against: r.pointsAgainst ?? 0,
    player_ids: r.players ?? [],
    starter_ids: r.starters ?? [],
    reserve_ids: r.reserve ?? [],
    taxi_ids: r.taxi ?? [],
    faab_remaining: 100,
    waiver_priority: 1,
  }))

  const standings = [...rosters]
    .sort((a, b) => b.points_for - a.points_for)
    .map((r, i) => ({
      source_team_id: r.source_team_id,
      rank: i + 1,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      points_for: r.points_for,
      points_against: r.points_against,
    }))

  return {
    source: {
      source_provider: 'sleeper',
      source_league_id: leagueId,
      source_season_id: String(season),
      import_batch_id: `batch-${leagueId}-${season}`,
      imported_at: '2025-11-15T12:00:00.000Z',
    },
    league: {
      name: opts?.name ?? 'Test Dynasty League',
      sport: 'NFL',
      season,
      leagueSize: rosters.length,
      rosterSize: 4,
      scoring: opts?.scoring ?? 'ppr',
      isDynasty: true,
      status: opts?.status ?? 'in_season',
      playoff_team_count: 4,
      roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN'],
      scoring_settings: { pass_td: 4, rec: 1 },
      ...(opts?.previousLeagueId ? { previous_league_id: opts.previousLeagueId } : {}),
    },
    rosters,
    scoring: { scoring_format: opts?.scoring ?? 'ppr', rules: [{ stat_key: 'rec', points_value: 1 }] },
    schedule: [
      {
        week: 1,
        season,
        matchups: rosters.length >= 2
          ? [{ roster_id_1: rosters[0].source_team_id, roster_id_2: rosters[1].source_team_id, points_1: 100, points_2: 90 }]
          : [],
      },
    ],
    draft_picks: [],
    traded_picks: (opts?.tradedPicks ?? []).map((p) => ({
      season: p.season,
      round: p.round,
      original_roster_id: p.original,
      current_owner_roster_id: p.owner,
    })),
    transactions: [],
    standings,
    player_map: {},
    identity_mappings: [],
    league_branding: { avatar_url: null, name: opts?.name ?? 'Test Dynasty League' },
    previous_seasons: [],
    coverage: buildCoverage(opts?.rostersCoverage ?? 'full'),
  }
}
