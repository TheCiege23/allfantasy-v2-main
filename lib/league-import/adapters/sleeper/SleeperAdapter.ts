import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { NormalizedImportResult, SourceTracking } from '../../types'
import { SleeperLeagueMapper } from './SleeperLeagueMapper'
import { SleeperRosterMapper } from './SleeperRosterMapper'
import { SleeperScoringMapper } from './SleeperScoringMapper'
import { SleeperScheduleMapper } from './SleeperScheduleMapper'
import { SleeperHistoryMapper } from './SleeperHistoryMapper'
import { mapSleeperTradedPicks } from './SleeperTradedPicksMapper'
import type { SleeperImportPayload } from './types'

export const SleeperAdapter: ILeagueImportAdapter<SleeperImportPayload> = {
  provider: 'sleeper',

  async normalize(raw) {
    const importBatchId = `sleeper-${raw.league?.league_id ?? 'unknown'}-${Date.now()}`
    const source: SourceTracking = {
      source_provider: 'sleeper',
      source_league_id: raw.league?.league_id ?? '',
      source_season_id: raw.league?.season ?? undefined,
      import_batch_id: importBatchId,
      imported_at: new Date().toISOString(),
    }

    const league = SleeperLeagueMapper.map(raw)
    const rosters = SleeperRosterMapper.map(raw)
    const scoring = SleeperScoringMapper.map(raw)
    const schedule = SleeperScheduleMapper.map(raw)
    const history = SleeperHistoryMapper.map(raw)
    // Block F — normalize `/traded_picks` into the canonical shape. Absent =
    // provider didn't include the field on this payload (fetch failure or
    // pre-Block-F caller); empty array = no picks currently in a traded state.
    const tradedPicks = raw.tradedPicks !== undefined ? mapSleeperTradedPicks(raw) : undefined
    const rosterCount = rosters.length
    const rostersWithPlayers = rosters.filter((roster) => (roster.player_ids?.length ?? 0) > 0).length
    const previousSeasonCount = raw.previousSeasons?.length ?? 0
    const hasScoringSettings =
      scoring?.rules?.length != null && scoring.rules.length > 0
    const hasPlayoffSettings =
      typeof league?.playoff_team_count === 'number' ||
      typeof (raw.league?.settings as Record<string, unknown> | undefined)?.playoff_week_start === 'number'

    const result: NormalizedImportResult = {
      source,
      // Phase 2.4 (§5) — forward non-fatal fetch failures so they persist as ImportWarnings.
      fetchWarnings: raw.fetchWarnings,
      league: league ?? {
        name: raw.league?.name ?? 'Imported League',
        sport: 'NFL',
        season: raw.league?.season ? parseInt(raw.league.season, 10) : null,
        leagueSize: raw.league?.total_rosters ?? 0,
        rosterSize: null,
        scoring: null,
        isDynasty: false,
      },
      rosters,
      scoring: scoring ?? null,
      schedule,
      draft_picks: history.draft_picks,
      traded_picks: tradedPicks,
      transactions: history.transactions,
      standings: history.standings,
      player_map: raw.playerMap ?? {},
      league_branding: raw.league?.avatar
        ? { avatar_url: `https://sleepercdn.com/avatars/thumbs/${raw.league.avatar}` }
        : undefined,
      previous_seasons: raw.previousSeasons?.map((s) => ({
        season: s.season,
        source_league_id: s.league.league_id,
      })),
      coverage: {
        leagueSettings: {
          state: 'full',
          count: 1,
        },
        currentRosters: {
          state:
            rosterCount === 0 ? 'missing' : rostersWithPlayers === rosterCount ? 'full' : 'partial',
          count: rosterCount,
          note:
            rosterCount > 0 && rostersWithPlayers !== rosterCount
              ? `${rosterCount - rostersWithPlayers} roster(s) are missing imported player data.`
              : null,
        },
        historicalRosterSnapshots: {
          state: previousSeasonCount > 0 ? 'partial' : 'missing',
          count: previousSeasonCount,
          note:
            previousSeasonCount > 0
              ? 'Historical roster snapshots are completed during post-import backfill, not preview normalization.'
              : 'No previous Sleeper seasons were discovered for this league.',
        },
        scoringSettings: {
          state: hasScoringSettings ? 'full' : 'partial',
          note: hasScoringSettings ? null : 'Scoring settings were only partially inferred from league metadata.',
        },
        playoffSettings: {
          state: hasPlayoffSettings ? 'full' : 'partial',
          note: hasPlayoffSettings ? null : 'Playoff settings were only partially inferred from league metadata.',
        },
        currentStandings: {
          state:
            history.standings.length === 0
              ? 'missing'
              : rosterCount > 0 && history.standings.length === rosterCount
                ? 'full'
                : 'partial',
          count: history.standings.length,
        },
        currentSchedule: {
          state: schedule.length > 0 ? 'full' : 'missing',
          count: schedule.length,
        },
        draftHistory: {
          state: history.draft_picks.length > 0 ? 'full' : 'missing',
          count: history.draft_picks.length,
        },
        tradeHistory: {
          state:
            previousSeasonCount > 0
              ? history.transactions.length > 0
                ? 'partial'
                : 'missing'
              : history.transactions.length > 0
                ? 'full'
                : 'missing',
          count: history.transactions.length,
          note:
            previousSeasonCount > 0
              ? 'Preview normalization includes current-league transactions; full historical trade import happens during backfill.'
              : null,
        },
        previousSeasons: {
          state: previousSeasonCount > 0 ? 'full' : 'missing',
          count: previousSeasonCount,
        },
        playerIdentityMap: {
          state: Object.keys(raw.playerMap ?? {}).length > 0 ? 'full' : 'partial',
          count: Object.keys(raw.playerMap ?? {}).length,
          note:
            Object.keys(raw.playerMap ?? {}).length > 0
              ? null
              : 'Player identity resolution was not available for this import preview.',
        },
      },
    }
    return result
  },
}
