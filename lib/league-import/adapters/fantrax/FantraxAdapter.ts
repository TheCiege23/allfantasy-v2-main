import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { NormalizedImportResult, SourceTracking } from '../../types'
import type { FantraxImportPayload } from './types'
import { FantraxLeagueMapper } from './FantraxLeagueMapper'
import { FantraxRosterMapper } from './FantraxRosterMapper'
import { FantraxScoringMapper } from './FantraxScoringMapper'
import { FantraxScheduleMapper } from './FantraxScheduleMapper'
import { FantraxHistoryMapper } from './FantraxHistoryMapper'

export const FantraxAdapter: ILeagueImportAdapter<FantraxImportPayload> = {
  provider: 'fantrax',

  async normalize(raw) {
    const importBatchId = `fantrax-${raw.league.leagueId}-${Date.now()}`
    const source: SourceTracking = {
      source_provider: 'fantrax',
      source_league_id: raw.league.leagueId,
      source_season_id: raw.league.season != null ? String(raw.league.season) : undefined,
      import_batch_id: importBatchId,
      imported_at: new Date().toISOString(),
    }

    const league = FantraxLeagueMapper.map(raw) ?? {
      name: raw.league.name,
      sport: raw.league.sport,
      season: raw.league.season,
      leagueSize: raw.league.size,
      rosterSize: null,
      scoring: null,
      isDynasty: raw.league.isDevy,
    }
    const rosters = FantraxRosterMapper.map(raw)
    const scoring = FantraxScoringMapper.map(raw)
    const schedule = FantraxScheduleMapper.map(raw)
    const history = FantraxHistoryMapper.map(raw)
    const playerMapCount = Object.keys(raw.playerMap ?? {}).length
    const rosterWithPlayersCount = rosters.filter((roster) => roster.player_ids.length > 0).length

    const viewerTeam = raw.teams.find((t) => t.managerId.startsWith('fantrax-user:'))

    const result: NormalizedImportResult = {
      source,
      viewer_source_team_id: viewerTeam?.teamId ?? null,
      league,
      rosters,
      scoring,
      schedule,
      draft_picks: history.draft_picks,
      transactions: history.transactions,
      standings: history.standings,
      player_map: raw.playerMap ?? {},
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
          state:
            rosters.length === 0
              ? 'missing'
              : rosterWithPlayersCount === rosters.length
                ? 'full'
                : 'partial',
          count: rosters.length,
          note:
            rosters.length > 0 && rosterWithPlayersCount !== rosters.length
              ? 'Fantrax roster exports include full player details only for teams included in uploaded CSV history.'
              : null,
        },
        historicalRosterSnapshots: {
          state: raw.previousSeasons.length > 0 ? 'partial' : 'missing',
          count: raw.previousSeasons.length,
          note:
            raw.previousSeasons.length > 0
              ? 'Historical Fantrax seasons were discovered from prior imported CSV snapshots.'
              : 'No historical Fantrax seasons were discovered for this league.',
        },
        scoringSettings: {
          state: scoring ? 'partial' : 'missing',
          count: scoring?.rules.length ?? 0,
          /*
           * ⚠ RULES EXISTING IS NOT THE SAME AS EVERY RULE BEING CARRIED. The
           * mapper names the categories it could not place, and dropping that
           * on the floor would present a partial scoring system as a whole one
           * — a silently wrong score rather than a visible gap.
           */
          note: (() => {
            const gaps = (scoring?.raw as { scoringGaps?: unknown })?.scoringGaps
            if (Array.isArray(gaps) && gaps.length > 0) {
              return `Some scoring categories were not carried across: ${gaps.join('; ')}.`
            }
            return scoring && scoring.rules.length > 0
              ? null
              : 'No scoring detail was available for this league; raw settings are preserved when present.'
          })(),
        },
        playoffSettings: {
          state: schedule.some((week) => week.matchups.length > 0) ? 'partial' : 'missing',
          /*
           * ⚠ THE FLAGS ARE NO LONGER AN INFERENCE on a live import. They are
           * set from the league's own `firstPlayoffPeriod`, so a flagged week
           * is one Fantrax calls a playoff week. Still `partial` because the
           * bracket itself is not modelled — and playoff periods carry no
           * pairings until the regular season seeds them.
           */
          note: "Playoff weeks are flagged from the league's own first playoff period; the bracket itself is not imported.",
        },
        /*
         * ⚠ "FULL" USED TO MEAN "THERE ARE ROWS", and rows always existed — one
         * per team, with a rank the mapper filled in from array position and a
         * record that defaulted to zero. That reads as a complete standings
         * table and is indistinguishable from a correct preseason one. It is
         * full only when every row carries a rank Fantrax actually published.
         */
        currentStandings: (() => {
          const ranked = raw.teams.filter((team) => team.rank != null).length
          return {
            state:
              history.standings.length === 0
                ? ('missing' as const)
                : ranked === raw.teams.length
                  ? ('full' as const)
                  : ('partial' as const),
            count: history.standings.length,
            note:
              history.standings.length > 0 && ranked !== raw.teams.length
                ? 'Fantrax did not publish standings for this league, so team order is not a real ranking.'
                : null,
          }
        })(),
        currentSchedule: {
          state: schedule.length > 0 ? 'partial' : 'missing',
          count: schedule.length,
          /*
           * ⚠ WAS "depends on uploaded standings/matchup exports", WHICH IS NO
           * LONGER THE ONLY SOURCE. A live import reads every period's fixtures
           * from the league API. What it does NOT read is results: getLeagueInfo
           * carries the pairings and not the scores, which live on
           * getMatchupScores?period=N, one request per period.
           */
          note:
            schedule.length > 0
              ? 'Fixtures come from the league schedule; scores are present only where a CSV export supplied them.'
              : 'No Fantrax matchup data was available for this league.',
        },
        draftHistory: {
          state: history.draft_picks.length > 0 ? 'partial' : 'missing',
          count: history.draft_picks.length,
          note:
            history.draft_picks.length > 0
              ? 'Fantrax draft history currently reflects traded draft-pick events when available.'
              : 'No Fantrax draft pick history was available from uploaded data.',
        },
        tradeHistory: {
          state: history.transactions.length > 0 ? 'partial' : 'missing',
          count: history.transactions.length,
          note:
            history.transactions.length > 0
              ? 'Fantrax transaction history is normalized from claims, drops, trades, and lineup change exports.'
              : 'No Fantrax transaction history was available from uploaded data.',
        },
        previousSeasons: {
          state: raw.previousSeasons.length > 0 ? 'partial' : 'missing',
          count: raw.previousSeasons.length,
        },
        playerIdentityMap: {
          state: playerMapCount > 0 ? 'partial' : 'missing',
          count: playerMapCount,
          note:
            playerMapCount > 0
              ? 'Fantrax player IDs are mapped from imported roster exports and remain stable for future sync.'
              : 'No Fantrax player identity map was available in imported roster exports.',
        },
      },
    }

    return result
  },
}
