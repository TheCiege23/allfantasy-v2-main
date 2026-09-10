import 'server-only'

import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { normalizeRiGameBox, recentDates } from '@/lib/sports-data/rollingInsightsGameLogs'
import type {
  PlayerGameLogImportSport,
  ProviderGameLogRow,
} from '@/lib/sports-reporting/PlayerGameLogImportService'

/**
 * Rolling Insights `/live` -> `ProviderGameLogRow[]`, so the game-log CACHE can be filled for
 * sports that have never had a real adapter.
 *
 * 🛑 WHY THIS EXISTS, AND IT IS NOT "NO INGESTION". Measured 2026-09-10, the codebase has TWO
 * game-log tables and nothing joins them:
 *
 *   player_game_stats      <- lib/sports-data/rollingInsightsGameLogs (scheduled daily,
 *                             multiSport=1, already covers MLB/NBA/NHL/NCAAB/SOCCER)
 *   player_game_log_cache  <- PlayerGameLogImportService  ...which had NO scheduled caller
 *                             ^ and THIS is the table `playerWeeklyScoreService` reads
 *
 * So provider data was arriving daily and the scorer could not see any of it. The cache table
 * held 7 NFL rows last written 2026-06-24. Filling `player_game_stats` harder would never have
 * fixed scoring for any sport, NFL included.
 *
 * ⚠ IT REUSES `normalizeRiGameBox` RATHER THAN PARSING `/live` AGAIN. That parser is already
 * measured against committed fixtures and already knows the shapes differ per sport — NBA keys
 * player_box by player id directly, NHL nests a `skaters`/`goalies` level first. A second parser
 * would be two implementations of one rule, free to drift, which is the failure this repo keeps
 * rediscovering. This module only MAPS its output into the cache writer's row type.
 *
 * ⚠ DATE-DRIVEN, NOT WEEK-DRIVEN. `/live/{date}/{SPORT}` is keyed on the US EASTERN date (a UTC
 * date 404s through primetime — see contracts/rolling-insights/GAPS.md) and returns started AND
 * finished games, so walking recent dates is both the live path and the backfill path. The
 * importer's `weeks` filter is therefore not a fetch parameter here; `weekOrRound` comes from the
 * provider and is carried through untouched.
 *
 * ⚠ AND `weekOrRound` IS NOT A FANTASY WEEK FOR A DAILY SPORT. NBA and NHL play most nights.
 * Mapping a league's scoring week onto a date range is a separate, unmade decision; nothing here
 * invents one. This module's job ends at "the game happened, here are the lines".
 */

/** Sports whose cache rows come from `/live`. NFL stays on Sleeper — it has a working adapter. */
export const RI_LIVE_GAME_LOG_SPORTS = new Set<PlayerGameLogImportSport>([
  'NBA',
  'NHL',
  'MLB',
  'NCAAB',
])

/**
 * How many days back a scheduled run sweeps.
 *
 * Three, not one: `/live` is Eastern-keyed and a late game finishing after midnight UTC lands on
 * the previous Eastern date, so a one-day window drops exactly the games most worth having. The
 * upsert is keyed on the game, so re-covering a date costs a request and writes nothing new.
 */
export const RI_LIVE_LOOKBACK_DAYS = 3

export async function fetchRiLiveGameLogRows(input: {
  sport: PlayerGameLogImportSport
  seasonType: string
  days?: number
  now?: Date
}): Promise<{ rows: ProviderGameLogRow[]; errors: string[]; warnings: string[] }> {
  const rows: ProviderGameLogRow[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const dates = recentDates(input.days ?? RI_LIVE_LOOKBACK_DAYS, input.now)

  for (const date of dates) {
    const out = await riFetchRows('live', { sport: input.sport, date })

    if (out.unsupported) {
      // The vendor does not document this endpoint/sport pair — a fact, not an outage.
      warnings.push(`${input.sport}: /live is not supported for this sport.`)
      break
    }
    if (out.notModified) {
      /*
       * A 304 that survived a cache-busted retry. The contract's `304_conflict` is UNRESOLVED —
       * cache artifact or genuine empty set — so this refuses to decide and writes nothing.
       * Reporting it as "no games" would be choosing one reading of a documented dispute.
       */
      warnings.push(`${input.sport} ${date}: unchanged/unknown (304 after retry) — left alone.`)
      continue
    }
    if (out.error) {
      errors.push(`${input.sport} ${date}: ${out.error}`)
      continue
    }

    for (const game of out.rows) {
      const box = normalizeRiGameBox(game)
      if (!box) continue
      for (const line of box.lines) {
        rows.push({
          provider: 'rolling_insights',
          sport: input.sport,
          providerPlayerId: line.providerPlayerId,
          playerName: line.playerName,
          team: line.team,
          opponent: line.opponent,
          gameId: box.providerGameId,
          week: box.weekOrRound,
          // `normalizeRiGameBox` reduces the provider's hyphenated span ("2025-2026") to a
          // start year. It did NOT before this change — `num()` gave null on a span, so the
          // season was silently absent for exactly the two sports being added here.
          season: box.season == null ? '' : String(box.season),
          seasonType: input.seasonType,
          playedAt: box.gameDate ? box.gameDate.toISOString() : null,
          status: box.status,
          stats: line.raw,
          raw: line.raw,
        })
      }
    }
  }

  if (!rows.length && !errors.length && !warnings.length) {
    /*
     * Not an error, and saying so matters. NBA and NHL are dark from roughly mid-June to
     * October; an empty sweep in September is the correct result, and calling it a failure is
     * how a healthy off-season job gets "fixed" into something worse.
     */
    warnings.push(
      `${input.sport}: no games found across ${dates.length} date(s) — expected out of season.`,
    )
  }

  return { rows, errors, warnings }
}
