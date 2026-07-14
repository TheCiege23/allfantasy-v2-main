import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { NormalizedImportResult, SourceTracking } from '../../types'
import type { EspnImportPayload } from './types'

function detectEspnScoringFormat(raw: EspnImportPayload): string | null {
  const receptionRule = raw.settings?.scoringItems.find((rule) => rule.statId === 53)
  const receptionPoints = receptionRule?.points ?? 0
  if (receptionPoints >= 1) return 'ppr'
  if (receptionPoints >= 0.5) return 'half'

  const scoringType = raw.settings?.scoringType?.toUpperCase() ?? ''
  if (scoringType.includes('TOTAL_POINTS')) return 'total-points'
  if (scoringType.includes('H2H_POINTS')) return 'h2h-points'
  if (scoringType.includes('H2H_CATEGORY')) return 'h2h-category'
  return raw.league.sport === 'NFL' ? 'standard' : raw.settings?.scoringType ?? null
}

function detectEspnDynasty(raw: EspnImportPayload): boolean {
  const settings = raw.settings?.raw ?? {}
  const keeperCount =
    typeof settings.keeperCount === 'number'
      ? settings.keeperCount
      : typeof settings.draftSettings === 'object' &&
          settings.draftSettings &&
          typeof (settings.draftSettings as Record<string, unknown>).keeperCount === 'number'
        ? ((settings.draftSettings as Record<string, unknown>).keeperCount as number)
        : 0
  return keeperCount > 0
}

export const EspnAdapter: ILeagueImportAdapter<EspnImportPayload> = {
  provider: 'espn',

  async normalize(raw) {
    const importBatchId = `espn-${raw.league.leagueId}-${Date.now()}`
    const source: SourceTracking = {
      source_provider: 'espn',
      source_league_id: raw.league.leagueId,
      source_season_id: raw.league.season != null ? String(raw.league.season) : undefined,
      import_batch_id: importBatchId,
      imported_at: new Date().toISOString(),
    }

    const scoringFormat = detectEspnScoringFormat(raw)
    const isDynasty = detectEspnDynasty(raw)
    const rosterPositions = raw.settings?.lineupSlotCounts ?? []
    const rosterSize =
      rosterPositions.length > 0
        ? rosterPositions.reduce((total, slot) => total + Math.max(0, slot.count), 0)
        : null
    const receptionRule = raw.settings?.scoringItems.find((rule) => rule.statId === 53)

    const rosters = raw.teams.map((team) => ({
      source_team_id: team.teamId,
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
            rules: raw.settings.scoringItems.map((rule) => ({
              stat_key: `espn_stat_${rule.statId}`,
              points_value: rule.points,
            })),
            raw: raw.settings.raw,
          }
        : null

    const schedule = raw.schedule.map((week) => ({
      week: week.week,
      season: week.season,
      matchups: week.matchups.map((matchup) => ({
        roster_id_1: matchup.teamId1,
        roster_id_2: matchup.teamId2,
        points_1: matchup.points1,
        points_2: matchup.points2,
      })),
    }))

    const transactions = raw.transactions
      .map((transaction) => ({
        source_transaction_id: transaction.transactionId,
        type:
          transaction.type === 'trade'
            ? ('trade' as const)
            : transaction.type === 'waiver'
              ? ('waiver' as const)
              : transaction.type === 'drop'
                ? ('drop' as const)
                : ('free_agent' as const),
        status: transaction.status,
        created_at: transaction.createdAt ?? source.imported_at,
        adds: Object.keys(transaction.adds).length > 0 ? transaction.adds : undefined,
        drops: Object.keys(transaction.drops).length > 0 ? transaction.drops : undefined,
        roster_ids: transaction.teamIds,
        draft_picks: [],
      }))
      .filter((transaction) => transaction.roster_ids.length > 0 || transaction.type === 'trade')

    const draftPicks = raw.draftPicks.map((pick) => ({
      round: pick.round,
      pick_no: pick.pickNumber,
      source_roster_id: pick.teamId,
      source_player_id: pick.playerId,
      season: raw.league.season,
      source_draft_id:
        pick.sourceDraftId ?? `${raw.league.leagueId}:${raw.league.season ?? 'unknown'}`,
      player_name: pick.playerName ?? null,
      position: pick.position ?? null,
      team: pick.team ?? null,
    }))

    const standings = raw.teams.map((team) => ({
      source_team_id: team.teamId,
      rank: team.rank ?? raw.teams.length,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      points_for: team.pointsFor,
      points_against: team.pointsAgainst ?? undefined,
    }))

    const playerMap = raw.teams.reduce<Record<string, { name: string; position: string; team: string }>>(
      (acc, team) => {
        Object.assign(acc, team.playerMap)
        return acc
      },
      {}
    )

    return {
      source,
      viewer_source_team_id: raw.viewerTeamId ?? null,
      league: {
        name: raw.league.name,
        sport: raw.league.sport,
        season: raw.league.season,
        leagueSize: raw.league.size,
        rosterSize,
        scoring: scoringFormat,
        isDynasty,
        // Same fix as SleeperLeagueMapper (Phase OS-C5): `League.status` has no DB
        // default, so a missing value here leaves imported leagues invisible on
        // Dashboard. ESPN has no direct status string — `raw.league.isFinished`
        // (derived from `status.finalScoringPeriod` vs. current matchup period)
        // is the real, honest signal ESPN's API actually exposes.
        status: raw.league.isFinished ? 'complete' : 'in_season',
        playoff_team_count: raw.settings?.playoffTeamCount ?? raw.league.playoffTeamCount ?? undefined,
        regular_season_length:
          raw.settings?.regularSeasonMatchupCount ??
          raw.settings?.matchupPeriodCount ??
          raw.league.regularSeasonLength ??
          undefined,
        schedule_unit: 'week',
        matchup_frequency: 'head_to_head',
        waiver_type: raw.settings?.usesFaab ? 'faab' : 'priority',
        faab_budget: raw.settings?.acquisitionBudget ?? null,
        roster_positions: rosterPositions.map((slot) => `${slot.slot}:${slot.count}`),
        scoring_settings: receptionRule ? { rec: receptionRule.points } : undefined,
        espn_settings: raw.settings?.raw ?? null,
      },
      rosters,
      scoring,
      schedule,
      draft_picks: draftPicks,
      transactions,
      standings,
      player_map: playerMap,
      previous_seasons: raw.previousSeasons.map((season) => ({
        season: season.season,
        source_league_id: season.sourceLeagueId,
      })),
      coverage: {
        leagueSettings: {
          state: 'full',
          count: 1,
        },
        currentRosters: {
          state: rosters.length > 0 ? 'full' : 'missing',
          count: rosters.length,
        },
        historicalRosterSnapshots: {
          state: raw.previousSeasons.length > 0 ? 'partial' : 'missing',
          count: raw.previousSeasons.length,
          note:
            raw.previousSeasons.length > 0
              ? 'Historical ESPN season-end roster snapshots are completed during post-import backfill for discovered prior seasons.'
              : 'No prior ESPN seasons were discovered for historical roster backfill.',
        },
        scoringSettings: {
          state:
            raw.settings?.scoringItems.length != null && raw.settings.scoringItems.length > 0
              ? 'full'
              : raw.settings
                ? 'partial'
                : 'missing',
          count: raw.settings?.scoringItems.length ?? 0,
          note:
            raw.settings?.scoringItems.length
              ? null
              : 'ESPN scoring settings were only partially available from league metadata.',
        },
        playoffSettings: {
          state:
            raw.settings?.playoffTeamCount != null || raw.settings?.matchupPeriodCount != null
              ? 'full'
              : raw.settings
                ? 'partial'
                : 'missing',
          note:
            raw.settings?.playoffTeamCount != null || raw.settings?.matchupPeriodCount != null
              ? null
              : 'ESPN playoff settings were only partially available from league metadata.',
        },
        currentStandings: {
          state: standings.length > 0 ? 'full' : 'missing',
          count: standings.length,
        },
        currentSchedule: {
          state: schedule.length > 0 ? 'full' : 'missing',
          count: schedule.length,
          note:
            schedule.length > 0
              ? null
              : 'No ESPN matchup schedule data was available for this league preview.',
        },
        draftHistory: {
          state:
            draftPicks.length > 0
              ? raw.previousSeasons.length > 0
                ? 'partial'
                : 'full'
              : raw.draftFetched
                ? 'missing'
                : 'partial',
          count: draftPicks.length,
          note:
            draftPicks.length > 0
              ? raw.previousSeasons.length > 0
                ? 'ESPN preview includes current-season draft results; discovered prior-season draft facts are completed during post-import backfill.'
                : null
              : raw.draftFetched
                ? 'The ESPN draft detail endpoint returned no picks for this league preview.'
                : 'ESPN draft detail was not available from the provider response for this league preview.',
        },
        tradeHistory: {
          state:
            transactions.length > 0
              ? raw.previousSeasons.length > 0
                ? 'partial'
                : 'full'
              : raw.transactionsFetched
                ? 'missing'
                : raw.league.season != null && raw.league.season < 2019
                  ? 'missing'
                  : 'partial',
          count: transactions.length,
          note:
            transactions.length > 0
              ? raw.previousSeasons.length > 0
                ? 'ESPN preview includes current-season transactions; discovered prior-season transaction facts are completed during post-import backfill.'
                : null
              : raw.league.season != null && raw.league.season < 2019
                ? 'ESPN transaction activity is not available for seasons before 2019.'
                : raw.transactionsFetched
                  ? 'No ESPN transaction activity matched the supported add, drop, waiver, or trade message types for this league preview.'
                  : 'ESPN transaction activity requires a provider response from the communication feed and may need league authentication.',
        },
        previousSeasons: {
          state: raw.previousSeasons.length > 0 ? 'partial' : 'missing',
          count: raw.previousSeasons.length,
          note:
            raw.previousSeasons.length > 0
              ? 'ESPN previous seasons were discovered by checking the same league ID across earlier seasons, then used during post-import backfill.'
              : 'No prior ESPN seasons were discovered for this league ID.',
        },
        playerIdentityMap: {
          state: Object.keys(playerMap).length > 0 ? 'partial' : 'missing',
          count: Object.keys(playerMap).length,
          note:
            Object.keys(playerMap).length > 0
              ? 'Current ESPN rosters include provider-local player identity metadata.'
              : 'ESPN player identity metadata was not available from the fetched rosters.',
        },
      },
    } satisfies NormalizedImportResult
  },
}
