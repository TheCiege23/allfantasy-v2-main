import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { NormalizedImportResult, SourceTracking } from '../../types'
import type { YahooImportPayload } from './types'

function detectYahooScoringFormat(raw: YahooImportPayload): string | null {
  const receptionCategory = raw.settings?.statCategories.find((category) => {
    const name = `${category.name ?? ''} ${category.displayName ?? ''}`.toLowerCase()
    return name.includes('reception') || name === 'rec'
  })
  if (!receptionCategory?.statId) {
    return raw.league.sport === 'NFL' ? 'standard' : raw.settings?.scoringType ?? null
  }

  const receptionModifier = raw.settings?.statModifiers.find(
    (modifier) => modifier.statId === receptionCategory.statId
  )
  const receptionValue = receptionModifier?.value ?? 0
  if (receptionValue >= 1) return 'ppr'
  if (receptionValue >= 0.5) return 'half'
  return 'standard'
}

function detectYahooDynasty(raw: YahooImportPayload): boolean {
  const settings = raw.settings?.raw ?? {}
  const keeperLikeKeys = ['keeper_players', 'is_keeper', 'uses_keepers', 'keeper_deadline']
  return keeperLikeKeys.some((key) => Boolean(settings[key]))
}

export const YahooAdapter: ILeagueImportAdapter<YahooImportPayload> = {
  provider: 'yahoo',

  async normalize(raw) {
    const importBatchId = `yahoo-${raw.league.leagueKey}-${Date.now()}`
    const source: SourceTracking = {
      source_provider: 'yahoo',
      source_league_id: raw.league.leagueKey,
      source_season_id: raw.league.season != null ? String(raw.league.season) : undefined,
      import_batch_id: importBatchId,
      imported_at: new Date().toISOString(),
    }

    const rosterPositions = raw.settings?.rosterPositions ?? []
    const rosterSize =
      rosterPositions.length > 0
        ? rosterPositions.reduce((total, slot) => total + Math.max(0, slot.count), 0)
        : null
    const scoringFormat = detectYahooScoringFormat(raw)
    const isDynasty = detectYahooDynasty(raw)
    const regularSeasonLength =
      raw.settings?.usesPlayoff && raw.settings.playoffStartWeek != null && raw.league.startWeek != null
        ? Math.max(0, raw.settings.playoffStartWeek - raw.league.startWeek)
        : raw.league.endWeek ?? undefined

    const rosters = raw.teams.map((team) => ({
      source_team_id: team.teamKey,
      source_manager_id: team.managerGuid || team.managerId || team.teamKey,
      owner_name: team.managerName || team.teamName,
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
      faab_remaining: team.faabBalance,
      waiver_priority: team.waiverPriority,
    }))

    const statCategoryById = new Map(
      (raw.settings?.statCategories ?? []).map((category) => [category.statId, category])
    )
    const scoring = raw.settings
      ? {
          scoring_format: scoringFormat ?? raw.settings.scoringType ?? 'standard',
          rules: raw.settings.statModifiers.map((rule) => {
            const category = statCategoryById.get(rule.statId)
            return {
              stat_key: `yahoo_stat_${rule.statId}`,
              points_value: rule.value,
              multiplier: undefined,
              name: category?.name ?? undefined,
              display_name: category?.displayName ?? undefined,
            }
          }),
          raw: raw.settings.raw,
        }
      : null

    const schedule = raw.schedule.map((week) => ({
      week: week.week,
      season: week.season,
      matchups: week.matchups.map((matchup) => ({
        roster_id_1: matchup.teamKey1,
        roster_id_2: matchup.teamKey2,
        points_1: matchup.points1,
        points_2: matchup.points2,
      })),
    }))

    const transactions = raw.transactions
      .map((transaction) => {
        const normalizedType =
          transaction.type === 'trade'
            ? 'trade'
            : transaction.type.includes('add')
              ? 'free_agent'
              : 'drop'
        return {
          source_transaction_id: transaction.transactionId,
          type: normalizedType as 'trade' | 'drop' | 'free_agent',
          status: transaction.status,
          created_at: transaction.createdAt ?? source.imported_at,
          adds: Object.keys(transaction.adds).length > 0 ? transaction.adds : undefined,
          drops: Object.keys(transaction.drops).length > 0 ? transaction.drops : undefined,
          roster_ids: transaction.teamKeys,
          draft_picks: [],
        }
      })
      .filter((transaction) => transaction.roster_ids.length > 0 || transaction.type === 'trade')

    const draftPicks = raw.draftPicks.map((pick) => ({
      round: pick.round,
      pick_no: pick.pickNumber,
      source_roster_id: pick.teamKey,
      source_player_id: pick.playerId,
      season: raw.league.season,
      source_draft_id: `${raw.league.leagueKey}:${raw.league.season ?? 'unknown'}`,
      player_name: pick.playerName ?? null,
      position: pick.position ?? null,
      team: pick.team ?? null,
    }))

    const standings = raw.teams.map((team) => ({
      source_team_id: team.teamKey,
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

    const result: NormalizedImportResult = {
      source,
      viewer_source_team_id: raw.viewerTeamKey ?? null,
      league: {
        name: raw.league.name,
        sport: raw.league.sport,
        season: raw.league.season,
        leagueSize: raw.league.numTeams,
        rosterSize,
        scoring: scoringFormat,
        isDynasty,
        // Same fix as SleeperLeagueMapper/EspnAdapter: `League.status` has no DB
        // default, so a missing value here leaves imported leagues invisible on
        // Dashboard. Yahoo exposes a real `is_finished` boolean directly
        // (`YahooImportLeague.isFinished`), already fetched but never surfaced.
        status: raw.league.isFinished ? 'complete' : 'in_season',
        playoff_team_count: raw.settings?.usesPlayoff ? undefined : 0,
        regular_season_length: regularSeasonLength,
        schedule_unit: raw.league.sport === 'NFL' ? 'week' : 'period',
        matchup_frequency: raw.settings?.scoringType ?? 'head',
        waiver_type: raw.settings?.usesFaab ? 'faab' : 'priority',
        faab_budget: null,
        roster_positions: rosterPositions.map((slot) => `${slot.position}:${slot.count}`),
        yahoo_settings: raw.settings?.raw ?? null,
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
              ? 'Historical Yahoo season-end roster snapshots are completed during post-import backfill.'
              : 'No prior Yahoo seasons were discovered for historical roster backfill.',
        },
        scoringSettings: {
          state: raw.settings?.statModifiers.length ? 'full' : raw.settings ? 'partial' : 'missing',
          count: raw.settings?.statModifiers.length ?? 0,
          note:
            raw.settings?.statModifiers.length
              ? null
              : 'Yahoo scoring settings were only partially available from league metadata.',
        },
        playoffSettings: {
          state: raw.settings ? 'full' : 'partial',
          note:
            raw.settings?.usesPlayoff != null
              ? null
              : 'Yahoo playoff settings were only partially available from league metadata.',
        },
        currentStandings: {
          state: standings.length > 0 ? 'full' : 'missing',
          count: standings.length,
        },
        currentSchedule: {
          state:
            schedule.length === 0
              ? 'missing'
              : raw.scheduleWeeksExpected != null && raw.scheduleWeeksCovered >= raw.scheduleWeeksExpected
                ? 'full'
                : 'partial',
          count: schedule.length,
          note:
            schedule.length === 0
              ? 'No Yahoo matchup data was available for this league preview.'
              : raw.scheduleWeeksExpected != null && raw.scheduleWeeksCovered >= raw.scheduleWeeksExpected
                ? null
                : 'Yahoo import captured part of the current-season matchup history, but not every expected week.',
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
                ? 'Yahoo preview includes current-league draft results; discovered historical Yahoo draft facts are completed during post-import backfill.'
                : null
              : 'No Yahoo draft results were available for this league preview.',
        },
        tradeHistory: {
          state:
            raw.transactions.length > 0
              ? raw.previousSeasons.length > 0
                ? 'partial'
                : 'full'
              : 'missing',
          count: transactions.length,
          note:
            raw.previousSeasons.length > 0
              ? 'Yahoo preview includes current-league transactions; discovered historical transaction import is completed during post-import backfill.'
              : raw.transactions.length > 0
                ? null
                : 'No Yahoo transactions were available for this league preview.',
        },
        previousSeasons: {
          state: raw.previousSeasons.length > 0 ? 'partial' : 'missing',
          count: raw.previousSeasons.length,
          note:
            raw.previousSeasons.length > 0
              ? 'Yahoo previous seasons were inferred from the connected account using matching league name, sport, and team count, then used during post-import backfill.'
              : 'No matching prior Yahoo seasons were discovered for this connected league.',
        },
        playerIdentityMap: {
          state: Object.keys(playerMap).length > 0 ? 'partial' : 'missing',
          count: Object.keys(playerMap).length,
          note:
            Object.keys(playerMap).length > 0
              ? 'Current Yahoo rosters include provider-local player identity metadata.'
              : 'Yahoo player identity metadata was not available from the fetched rosters.',
        },
      },
    }

    return result
  },
}
