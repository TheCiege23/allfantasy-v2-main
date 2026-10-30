import type { ILeagueImportAdapter } from '../ILeagueImportAdapter'
import type { NormalizedImportResult, SourceTracking } from '../../types'
import type { FantraxImportPayload } from './types'
import { FantraxLeagueMapper } from './FantraxLeagueMapper'
import { FantraxRosterMapper } from './FantraxRosterMapper'
import { FantraxScoringMapper } from './FantraxScoringMapper'
import { FantraxScheduleMapper } from './FantraxScheduleMapper'
import { FantraxHistoryMapper } from './FantraxHistoryMapper'
import { emptyableHistoryCoverage } from '@/lib/league-import/coverageCompleteness'

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
    const preDraftEmptyRosters = league.status === 'pre_draft' && rosterWithPlayersCount === 0
    const publishedLineup = raw.settings?.raw?.rosterInfo
    const hasPublishedLineup = Boolean(
      publishedLineup && typeof publishedLineup === 'object' &&
      Object.keys((publishedLineup as { positionConstraints?: Record<string, unknown> }).positionConstraints ?? {}).length > 0,
    )
    const mappedPositions = (league as Record<string, unknown>).roster_positions
    const lineupNotMapped = hasPublishedLineup && (!Array.isArray(mappedPositions) || mappedPositions.length === 0)

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
          state: lineupNotMapped ? 'partial' : 'full',
          count: 1,
          note: lineupNotMapped
            ? 'Fantrax published lineup positions, but this import could not map them to an exact AllFantasy lineup. Review roster settings before using lineup advice.'
            : null,
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
            preDraftEmptyRosters
              ? 'All teams were imported; their player rosters are empty because this league has not drafted.'
              : rosters.length > 0 && rosterWithPlayersCount !== rosters.length
              ? 'Some Fantrax team rosters have no player details in this import.'
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
        /*
         * ⚠ WAS "depends on uploaded standings/matchup exports", THEN "fixtures
         * but no results". Both are now out of date: `getMatchupScores?period=N`
         * is implemented and called, so a live import carries results for every
         * period that has been played.
         *
         * ⚠ AND "SOME ROWS HAVE SCORES" IS NOT THE SAME AS "THE SCHEDULE IS
         * FULL". A season half played has half its fixtures legitimately
         * unscored, and calling that partial would report a healthy league as
         * incomplete every week until January. What is reported instead is how
         * many weeks carry results — a count the reader can check against the
         * calendar, rather than a state that conflates "not played yet" with
         * "not imported".
         */
        currentSchedule: (() => {
          const scoredWeeks = schedule.filter((week) =>
            week.matchups.some((m) => m.points_1 != null || m.points_2 != null),
          ).length
          return {
            state: schedule.length > 0 ? ('partial' as const) : ('missing' as const),
            count: schedule.length,
            note:
              schedule.length === 0
                ? 'No Fantrax matchup data was available for this league.'
                : scoredWeeks > 0
                  ? `Fixtures and results come from the league itself; ${scoredWeeks} of ${schedule.length} weeks have been scored.`
                  : 'Fixtures come from the league schedule. No week has been played yet, so no scores are on file.',
          }
        })(),
        /*
         * ⚠ BOTH NOTES MUST HOLD FOR A LIVE (league-id) IMPORT AS WELL AS A CSV ONE. A live import
         * now STORES the draft board (`fantraxDraft` in the snapshot's `transactions` column, see
         * `fantraxSnapshotHistory.ts`), so its picks arrive here with real Fantrax player ids and
         * reach `DraftFact`. Fantrax publishes no transactions endpoint: a live import can only
         * INFER moves by comparing each refresh's rosters with the previous one, and those rows
         * carry `status: inferred` / `suspected`. An uploaded export supplies recorded transactions.
         */
        draftHistory: (() => {
          const fromBoard = raw.historySources?.draftBoard === true
          return {
            state: history.draft_picks.length > 0 ? ('partial' as const) : ('missing' as const),
            count: history.draft_picks.length,
            note: fromBoard
              ? `The Fantrax draft board is stored on import and refresh: ${history.draft_picks.length} picks made this season. Earlier seasons' drafts are not imported.`
              : history.draft_picks.length > 0
                ? 'Fantrax draft history currently reflects traded draft-pick events from an uploaded export.'
                : 'No Fantrax draft picks are on file: a league-id import stores the draft board once the league has drafted (none was readable yet), and an uploaded export carries only traded-pick events.',
          }
        })(),
        tradeHistory: (() => {
          const derived = raw.historySources?.derivedTransactions ?? 0
          const exported = raw.historySources?.exportTransactions ?? history.transactions.length - derived
          const parts: string[] = []
          if (exported > 0) parts.push('Fantrax transaction history is normalized from claims, drops, trades, and lineup change exports.')
          if (derived > 0) {
            parts.push(
              `${derived} roster moves were inferred by comparing this league's rosters between refreshes (Fantrax publishes no transactions feed); a move made and reversed between two refreshes is not seen, and a two-way exchange is only marked as a suspected trade.`,
            )
          }
          return {
            /* Same ambiguity as Yahoo and MFL: a required array, so `[]` proves nothing. */
            state:
              history.transactions.length > 0
                ? ('partial' as const)
                : emptyableHistoryCoverage({ fetched: null, unit: 'trades' }).state,
            count: history.transactions.length,
            note:
              parts.length > 0
                ? parts.join(' ')
                : 'No Fantrax transaction history is on file yet: Fantrax publishes no transactions feed, so a league-id import only infers moves by comparing rosters between refreshes (none observed so far), and an uploaded transaction export supplies recorded ones.',
          }
        })(),
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
