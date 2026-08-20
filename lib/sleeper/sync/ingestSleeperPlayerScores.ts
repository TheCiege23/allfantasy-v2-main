/*
 * ⚠ NO `import 'server-only'` HERE, DELIBERATELY, AND ITS SIBLINGS DO THE SAME.
 * `backfillSleeperDraftIds.ts` and `sleeperHostedDraftHistory.ts` both omit it
 * for the same reason: these modules are invoked by scripts as well as by server
 * code, and `server-only` throws the moment a plain Node/tsx process imports
 * them. It bought nothing here — this module has no client caller and could not
 * acquire one without also importing prisma — and it cost the backfill script
 * the ability to reuse the writer instead of duplicating it.
 *
 * ⚠ THE TEST SUITE WOULD NOT HAVE CAUGHT THIS. vitest stubs `server-only`, so
 * all nine tests passed with the import present. `npx tsx` is the honest control
 * for whether a lib module is script-importable.
 */
import { prisma } from '@/lib/prisma'
import { getLeagueMatchups } from '@/lib/sleeper-client'

/**
 * Sleeper → `league_player_weekly_scores`: per-player weekly scoring for an
 * imported league, stored as Sleeper itself scored it.
 *
 * This is the writer whose absence made `lib/core-app/matchup.ts` declare
 * `playerScoring` unavailable ("per-player weekly scoring is not ingested for
 * imported leagues"). Every other piece already existed — the endpoint, the
 * client, the typed payload — but nothing joined them to storage.
 *
 * ⚠ POINTS ARE STORED AS SLEEPER REPORTS THEM AND ARE NEVER RECOMPUTED.
 * `players_points` is already scored by that league's own settings. Re-deriving
 * it from raw stats would mean reproducing Sleeper's arithmetic — including
 * whatever custom rules the commissioner set — and any mismatch shows the user a
 * number their own platform disagrees with. The whole value of an imported
 * league is fidelity to the source. This is also why no other provider can fill
 * this gap: contracts/rolling-insights/ENDPOINTS.yaml states its only fantasy
 * fields are DraftKings scoring, explicitly "useless for custom league settings".
 *
 * ⚠ IDS STAY IN PROVIDER SPACE. See the model doc — resolving to canonical
 * players here would discard the ~13% that do not bridge. The read path resolves
 * them, and it already knows how.
 */

/** What one league-week ingestion did, in terms a caller can act on. */
export type IngestSleeperPlayerScoresResult = {
  leagueId: string
  season: number
  week: number
  /** Rows written or refreshed. */
  scoresUpserted: number
  /** Rosters whose week carried no real scoring yet, so nothing was written. */
  rostersSkippedUnscored: number
  /**
   * Rosters Sleeper returned with a `players_points` map we could not read.
   * Surfaced rather than swallowed — a provider shape change should be visible,
   * not silently produce an empty week.
   */
  rostersMalformed: number
  /** Never thrown past the caller; a bad week must not abort a multi-week run. */
  error: string | null
}

/**
 * A Sleeper matchup row with no real recorded scoring yet.
 *
 * ⚠ SLEEPER RETURNS A PLACEHOLDER ROW FOR EVERY WEEK/ROSTER REGARDLESS OF
 * WHETHER IT HAS BEEN PLAYED, with all-zero points. Writing those would fill the
 * table with zeroes that are indistinguishable from "he played and scored
 * nothing" — the exact null-is-not-zero confusion `LineupPlayer.projectedPoints`
 * already documents. Borrowed from the replay framework's
 * `ingestSleeperLineupsForLeague`, which hit this first.
 */
function hasRealScoring(points: number, startersPoints: number[]): boolean {
  return points > 0 || startersPoints.some((p) => p > 0)
}

/**
 * Ingest one league-week.
 *
 * `platformLeagueId` is the SLEEPER league id — the same space
 * `WeeklyMatchup.leagueId` uses, so the two join without a translation step.
 *
 * `isFinalized` is deliberately not a parameter here and always writes false.
 * Stat corrections reprocess for ~12h after a game ends, so nothing this writer
 * observes at ingestion time can justify calling a score final; only a later
 * reconcile pass can. Leaving it false is the honest default — a consumer that
 * needs certainty can check the flag and find it absent.
 */
export async function ingestSleeperPlayerScoresForWeek(
  platformLeagueId: string,
  season: number,
  week: number,
): Promise<IngestSleeperPlayerScoresResult> {
  const result: IngestSleeperPlayerScoresResult = {
    leagueId: platformLeagueId,
    season,
    week,
    scoresUpserted: 0,
    rostersSkippedUnscored: 0,
    rostersMalformed: 0,
    error: null,
  }

  let matchups
  try {
    matchups = await getLeagueMatchups(platformLeagueId, week)
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
    return result
  }

  if (!Array.isArray(matchups) || matchups.length === 0) {
    return result
  }

  for (const m of matchups) {
    const startersPoints = Array.isArray(m.starters_points) ? m.starters_points : []
    if (!hasRealScoring(Number(m.points) || 0, startersPoints)) {
      result.rostersSkippedUnscored += 1
      continue
    }

    const pointsByPlayer = m.players_points
    if (!pointsByPlayer || typeof pointsByPlayer !== 'object') {
      result.rostersMalformed += 1
      continue
    }

    // Starters are identified by position in `starters`, which is how Sleeper
    // pairs them with `starters_points`. Membership is all we need here.
    const starterIds = new Set(Array.isArray(m.starters) ? m.starters : [])

    /*
     * ⚠ READ AS `unknown`, NOT AS THE DECLARED `number`. `SleeperMatchup` types
     * `players_points` as Record<string, number>, but that is a claim about the
     * provider rather than a guarantee about the bytes on the wire — nothing
     * validates the payload at the boundary. Trusting the declared type made
     * `raw === ''` unreachable-by-type and tsc rejected it, which is the compiler
     * correctly pointing out that the guard and the type disagree. The runtime is
     * the one that decides, so the value is widened here and narrowed below.
     */
    const rawEntries = Object.entries(pointsByPlayer) as Array<[string, unknown]>

    for (const [playerId, raw] of rawEntries) {
      /*
       * ⚠ THE ABSENCE CHECK HAS TO COME BEFORE THE COERCION, AND MY FIRST VERSION
       * DID NOT. `Number(null)` is 0 and `Number.isFinite(0)` is true, so guarding
       * only on the coerced value lets a missing score through as a real zero —
       * writing a row that asserts "he scored nothing" from a value that said
       * nothing at all. Caught by the test below, not by review.
       *
       * Null is not zero: the same rule `LineupPlayer.projectedPoints` states, and
       * the same direction of harm — a fabricated zero drags a lineup total down
       * and makes someone bench a player they should start.
       */
      if (raw === null || raw === undefined || raw === '') continue
      const points = Number(raw)
      if (!Number.isFinite(points)) continue

      /*
       * ⚠ SLEEPER USES "0" AS THE EMPTY-SLOT MARKER in `starters`. It is not a
       * player id and must never become a row, or every league with an unfilled
       * starter slot grows a phantom player who scores.
       */
      if (!playerId || playerId === '0') continue

      await prisma.leaguePlayerWeeklyScore.upsert({
        where: {
          leagueId_seasonYear_week_playerId: {
            leagueId: platformLeagueId,
            seasonYear: season,
            week,
            playerId,
          },
        },
        update: {
          points,
          isStarter: starterIds.has(playerId),
          rosterId: Number.isFinite(Number(m.roster_id)) ? Number(m.roster_id) : null,
          source: 'sleeper',
        },
        create: {
          leagueId: platformLeagueId,
          seasonYear: season,
          week,
          playerId,
          points,
          isStarter: starterIds.has(playerId),
          rosterId: Number.isFinite(Number(m.roster_id)) ? Number(m.roster_id) : null,
          isFinalized: false,
          source: 'sleeper',
        },
      })
      result.scoresUpserted += 1
    }
  }

  return result
}
