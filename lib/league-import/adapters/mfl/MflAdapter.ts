import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { NormalizedImportResult, SourceTracking } from '../../types'
import type { MflImportPayload } from './types'

function detectMflScoringFormat(raw: MflImportPayload): string | null {
  const scoringType = `${raw.settings?.scoringType ?? raw.league.name ?? ''}`.toLowerCase()
  if (scoringType.includes('ppr') || scoringType.includes('point per reception')) return 'ppr'
  if (scoringType.includes('half') || scoringType.includes('0.5')) return 'half'
  return raw.league.sport === 'NFL' ? 'standard' : raw.settings?.scoringType ?? null
}

function detectMflDynasty(raw: MflImportPayload): boolean {
  const settings = raw.settings?.raw ?? {}
  const keeperLikeKeys = [
    'keeper',
    'keepers',
    'dynasty',
    'uses_future_draft_picks',
    'future_draft_picks',
    'uses_contracts',
    'salary_cap_amount',
    'taxi_squad',
  ]

  return keeperLikeKeys.some((key) => {
    const value = settings[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value > 0
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      return normalized === 'yes' || normalized === 'true' || normalized === '1' || normalized === 'dynasty'
    }
    return false
  })
}

export const MflAdapter: ILeagueImportAdapter<MflImportPayload> = {
  provider: 'mfl',

  async normalize(raw) {
    const importBatchId = `mfl-${raw.league.leagueId}-${Date.now()}`
    const source: SourceTracking = {
      source_provider: 'mfl',
      source_league_id: raw.league.leagueId,
      source_season_id: raw.league.season != null ? String(raw.league.season) : undefined,
      import_batch_id: importBatchId,
      imported_at: new Date().toISOString(),
    }

    const scoringFormat = detectMflScoringFormat(raw)
    const isDynasty = detectMflDynasty(raw)
    const rosterPositions = raw.settings?.rosterPositions ?? []
    const rosterSize =
      rosterPositions.length > 0
        ? rosterPositions.reduce((total, slot) => total + Math.max(0, slot.count), 0)
        : raw.teams.reduce((max, team) => Math.max(max, team.rosterPlayerIds.length), 0) || null

    const rosters = raw.teams.map((team) => ({
      source_team_id: team.franchiseId,
      source_manager_id: team.managerId,
      owner_name: team.managerName,
      team_name: team.teamName,
      avatar_url: team.logoUrl,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      points_for: team.pointsFor,
      points_against: team.pointsAgainst ?? undefined,
      player_ids: team.rosterPlayerIds,
      starter_ids: team.starterPlayerIds,
      reserve_ids: team.reservePlayerIds,
      taxi_ids: [],
      faab_remaining: team.faabRemaining,
      waiver_priority: team.waiverPriority,
    }))

    const scoring =
      raw.settings != null
        ? {
            scoring_format: scoringFormat ?? raw.settings.scoringType ?? 'standard',
            rules: [],
            raw: raw.settings.raw,
          }
        : null

    const schedule = raw.schedule.map((week) => ({
      week: week.week,
      season: week.season,
      matchups: week.matchups.map((matchup) => ({
        roster_id_1: matchup.franchiseId1,
        roster_id_2: matchup.franchiseId2,
        points_1: matchup.points1,
        points_2: matchup.points2,
      })),
    }))

    const transactions = raw.transactions.map((transaction) => ({
      source_transaction_id: transaction.transactionId,
      type:
        transaction.type.includes('trade')
          ? ('trade' as const)
          : transaction.type.includes('waiver')
            ? ('waiver' as const)
            : transaction.type.includes('drop')
              ? ('drop' as const)
              : ('free_agent' as const),
      status: transaction.status,
      created_at: transaction.createdAt ?? source.imported_at,
      adds: Object.keys(transaction.adds).length > 0 ? transaction.adds : undefined,
      drops: Object.keys(transaction.drops).length > 0 ? transaction.drops : undefined,
      roster_ids: transaction.franchiseIds,
      draft_picks: [],
    }))

    const draftPicks = raw.draftPicks.map((pick) => ({
      round: pick.round,
      pick_no: pick.pickNumber,
      source_roster_id: pick.franchiseId,
      source_player_id: pick.playerId,
      season: raw.league.season,
      source_draft_id: `${raw.league.leagueId}:${raw.league.season ?? 'unknown'}`,
      player_name: pick.playerName ?? null,
      position: pick.position ?? null,
      team: pick.team ?? null,
    }))

    const standings = raw.teams.map((team) => ({
      source_team_id: team.franchiseId,
      rank: team.rank ?? raw.teams.length,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      points_for: team.pointsFor,
      points_against: team.pointsAgainst ?? undefined,
    }))

    const playerIdentityCount = Object.keys(raw.playerMap).length
    const rosterPlayerCount = new Set(raw.teams.flatMap((team) => team.rosterPlayerIds)).size

    return {
      source,
      league: {
        name: raw.league.name,
        sport: raw.league.sport,
        season: raw.league.season,
        leagueSize: raw.league.size,
        rosterSize,
        scoring: scoringFormat,
        isDynasty,
        // Same fix as Sleeper/ESPN/Yahoo: `League.status` has no DB default, so a
        // missing value here leaves imported leagues invisible on Dashboard. MFL's
        // real signal is coarser (season-year comparison, not a live in-season
        // flag) but still real, not fabricated — `raw.league.isFinished`.
        status: raw.league.isFinished ? 'complete' : 'in_season',
        playoff_team_count: raw.league.playoffTeamCount ?? undefined,
        regular_season_length: raw.league.regularSeasonLength ?? undefined,
        schedule_unit: 'week',
        matchup_frequency: 'head_to_head',
        waiver_type: raw.settings?.usesFaab ? 'faab' : raw.settings?.waiverType ?? undefined,
        faab_budget: raw.settings?.acquisitionBudget ?? null,
        roster_positions: rosterPositions.map((slot) => `${slot.position}:${slot.count}`),
        mfl_settings: raw.settings?.raw ?? null,
      },
      rosters,
      scoring,
      schedule,
      draft_picks: draftPicks,
      transactions,
      standings,
      player_map: raw.playerMap,
      previous_seasons: raw.previousSeasons.map((season) => ({
        season: season.season,
        source_league_id: season.sourceLeagueId,
      })),
      coverage: {
        leagueSettings: {
          state: raw.settings ? 'full' : 'partial',
          count: 1,
          note: raw.settings ? null : 'MFL league metadata was available, but detailed settings were only partially parsed.',
        },
        currentRosters: {
          state:
            rosters.length === 0
              ? 'missing'
              : raw.lineupBreakdownAvailable
                ? 'full'
                : 'partial',
          count: rosters.length,
          note:
            rosters.length === 0
              ? 'No MFL roster data was available for this league.'
              : raw.lineupBreakdownAvailable
                ? null
                : 'MFL roster players were imported, but starter versus bench status was not fully exposed by the fetched roster payload.',
        },
        historicalRosterSnapshots: {
          state: raw.previousSeasons.length > 0 ? 'partial' : 'missing',
          count: raw.previousSeasons.length,
          note:
            raw.previousSeasons.length > 0
              ? 'Historical MFL season-end roster snapshots are completed during post-import backfill for discovered prior seasons.'
              : 'No prior MFL seasons were discovered for historical roster backfill.',
        },
        scoringSettings: {
          state: raw.settings ? 'partial' : 'missing',
          count: 0,
          note:
            raw.settings
              ? 'MFL scoring format and raw settings were imported, but detailed rule-by-rule scoring normalization is still partial.'
              : 'MFL scoring settings were not available from the fetched league metadata.',
        },
        playoffSettings: {
          state:
            raw.league.playoffTeamCount != null || raw.league.regularSeasonLength != null
              ? 'full'
              : raw.settings
                ? 'partial'
                : 'missing',
          note:
            raw.league.playoffTeamCount != null || raw.league.regularSeasonLength != null
              ? null
              : 'MFL playoff settings were only partially available from league metadata.',
        },
        currentStandings: {
          state: standings.length > 0 ? 'full' : 'missing',
          count: standings.length,
        },
        currentSchedule: {
          state: schedule.length > 0 ? 'partial' : 'missing',
          count: schedule.length,
          note:
            schedule.length > 0
              ? 'MFL matchup weeks were imported when schedule data was available, but expected-week coverage is not fully verified yet.'
              : 'No MFL schedule data was available for this league preview.',
        },
        draftHistory: {
          state:
            draftPicks.length > 0
              ? raw.previousSeasons.length > 0
                ? 'partial'
                : 'full'
              : 'missing',
          count: draftPicks.length,
          note:
            draftPicks.length > 0
              ? raw.previousSeasons.length > 0
                ? 'MFL preview includes accessible current-league draft results; discovered prior-season draft facts are completed during post-import backfill.'
                : null
              : 'No MFL draft results were available for this league preview.',
        },
        tradeHistory: {
          state:
            transactions.length > 0
              ? raw.previousSeasons.length > 0
                ? 'partial'
                : 'full'
              : 'missing',
          count: transactions.length,
          note:
            transactions.length > 0
              ? raw.previousSeasons.length > 0
                ? 'MFL preview includes accessible current-league transactions; discovered prior-season transaction facts are completed during post-import backfill.'
                : null
              : 'No MFL transactions were available for this league preview.',
        },
        previousSeasons: {
          state: raw.previousSeasons.length > 0 ? 'partial' : 'missing',
          count: raw.previousSeasons.length,
          note:
            raw.previousSeasons.length > 0
              ? 'MFL previous seasons were discovered by checking the same league ID across earlier seasons, then used during post-import backfill.'
              : 'No prior MFL seasons were discovered for this league ID.',
        },
        playerIdentityMap: {
          state:
            playerIdentityCount === 0
              ? 'missing'
              : playerIdentityCount >= rosterPlayerCount && rosterPlayerCount > 0
                ? 'full'
                : 'partial',
          count: playerIdentityCount,
          note:
            playerIdentityCount > 0 && playerIdentityCount < rosterPlayerCount
              ? 'MFL player IDs were matched through the local player identity map where possible.'
              : playerIdentityCount === 0
                ? 'No local player identity matches were found for the imported MFL player IDs.'
                : null,
        },
      },
    } satisfies NormalizedImportResult
  },
}
