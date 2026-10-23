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
import { randomUUID } from 'node:crypto'
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
  /**
   * Rows actually INSERTED or CHANGED by this call — never rows that were already correct.
   *
   * ⚠ THIS USED TO COUNT EVERY ROW SENT TO THE DATABASE, changed or not, so a sync of an
   * unchanged week reported hundreds of "upserts". `liveSleeperPointsSync` reads it as "this
   * league's board moved" and reruns season outlooks on it, so the old count reran them on
   * every pass whether or not a single point had changed.
   */
  scoresUpserted: number
  /** Rows the provider reported that were already stored exactly as reported — nothing written. */
  scoresUnchanged: number
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
function scoreNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function hasRealScoring(points: unknown, startersPoints: unknown[]): boolean {
  return [points, ...startersPoints].some(value => {
    const score = scoreNumber(value)
    return score !== null && score !== 0
  })
}

type StoredScore = {
  playerId: string
  rosterId: number | null
  points: number
  isStarter: boolean
  source: string
}

type IncomingScore = {
  id: string
  playerId: string
  rosterId: number | null
  points: number
  isStarter: boolean
}

/** Stored exactly as Sleeper now reports it, so writing it again would change nothing. */
function sameScore(stored: StoredScore, incoming: IncomingScore): boolean {
  return (
    stored.source === 'sleeper' &&
    stored.points === incoming.points &&
    stored.rosterId === incoming.rosterId &&
    stored.isStarter === incoming.isStarter
  )
}

/**
 * Ingest one league-week.
 *
 * `platformLeagueId` is the SLEEPER league id — the same space
 * `WeeklyMatchup.leagueId` uses, so the two join without a translation step.
 *
 * `isFinalized` is deliberately not a parameter here. Stat corrections reprocess
 * for ~12h after a game ends, so nothing this writer observes at ingestion time
 * can justify calling a score final; only a later reconcile pass can. A row this
 * writer inserts or CHANGES is therefore written provisional (`false`).
 *
 * 🛑 AN UNCHANGED ROW IS NOT WRITTEN AT ALL, AND THAT IS WHAT KEEPS A SEALED SCORE SEALED.
 * This used to upsert every row on every call with `isFinalized: false`, so each re-sync of a
 * finished week (every five minutes, per league, from the active lane) un-sealed every score
 * the reconcile pass in `lib/draft-archive/ingestion/importedResults.ts` had sealed, and that
 * pass then had to seal them all again. A score the provider still reports identically has
 * not been corrected, so there is nothing to make provisional.
 *
 * ⚠ ONE READ AND AT MOST ONE WRITE PER LEAGUE-WEEK. The stored week is read once (it also
 * answers the "has this roster-week been scored before" question that used to be one query per
 * roster), and only new or changed rows are sent, in one statement. The statement re-checks
 * `IS DISTINCT FROM` itself, so a row another writer brought up to date between the read and
 * the write is left alone rather than un-sealed.
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
    scoresUnchanged: 0,
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

  let stored: StoredScore[]
  try {
    stored = await prisma.leaguePlayerWeeklyScore.findMany({
      where: { leagueId: platformLeagueId, seasonYear: season, week },
      select: { playerId: true, rosterId: true, points: true, isStarter: true, source: true },
    })
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
    return result
  }
  const storedByPlayer = new Map(stored.map(row => [row.playerId, row]))
  const scoredRosters = new Set(
    stored.filter(row => row.source === 'sleeper' && row.rosterId !== null).map(row => row.rosterId),
  )

  /*
   * Keyed by player, last roster wins — the same row the old one-upsert-per-player loop left
   * behind when a player appeared under two rosters. It also matters for correctness now: one
   * INSERT … ON CONFLICT cannot touch the same row twice, and Postgres rejects the whole
   * statement if it is asked to.
   */
  const incoming = new Map<string, IncomingScore>()

  for (const m of matchups) {
    const startersPoints = Array.isArray(m.starters_points) ? m.starters_points : []
    const pointsByPlayer = m.players_points
    if (!pointsByPlayer || typeof pointsByPlayer !== 'object' || Array.isArray(pointsByPlayer)) {
      result.rostersMalformed += 1
      continue
    }

    if (!hasRealScoring(m.points, startersPoints)) {
      // A previously scored roster can legitimately be corrected back to zero.
      // Unknown/future roster-weeks still have no evidence of actual scoring.
      const rosterId = scoreNumber(m.roster_id)
      const recorded = rosterId !== null && Number.isSafeInteger(rosterId) && rosterId > 0 && scoredRosters.has(rosterId)
      if (!recorded) {
        result.rostersSkippedUnscored += 1
        continue
      }
    }

    // Starters are identified by position in `starters`, which is how Sleeper
    // pairs them with `starters_points`. Membership is all we need here.
    const starterIds = new Set(Array.isArray(m.starters) ? m.starters : [])
    const rosterId = Number.isFinite(Number(m.roster_id)) ? Number(m.roster_id) : null

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
      const points = scoreNumber(raw)
      if (points === null) continue

      /*
       * ⚠ SLEEPER USES "0" AS THE EMPTY-SLOT MARKER in `starters`. It is not a
       * player id and must never become a row, or every league with an unfilled
       * starter slot grows a phantom player who scores.
       */
      if (!playerId || playerId === '0') continue

      incoming.delete(playerId)
      incoming.set(playerId, {
        id: randomUUID(),
        playerId,
        rosterId,
        points,
        isStarter: starterIds.has(playerId),
      })
    }
  }

  const changed: IncomingScore[] = []
  for (const row of incoming.values()) {
    const prior = storedByPlayer.get(row.playerId)
    if (prior && sameScore(prior, row)) result.scoresUnchanged += 1
    else changed.push(row)
  }
  if (changed.length === 0) return result

  try {
    result.scoresUpserted = await prisma.$executeRaw`
      INSERT INTO league_player_weekly_scores
        (id, "leagueId", "seasonYear", week, "playerId", "rosterId", points, "isStarter",
         "isFinalized", source, "createdAt", "updatedAt")
      SELECT r.id, ${platformLeagueId}, ${season}, ${week}, r."playerId", r."rosterId", r.points,
             r."isStarter", false, 'sleeper', now(), now()
        FROM jsonb_to_recordset(${JSON.stringify(changed)}::jsonb)
          AS r(id text, "playerId" text, "rosterId" integer, points double precision, "isStarter" boolean)
      ON CONFLICT ("leagueId", "seasonYear", week, "playerId") DO UPDATE
        SET points = EXCLUDED.points,
            "rosterId" = EXCLUDED."rosterId",
            "isStarter" = EXCLUDED."isStarter",
            source = EXCLUDED.source,
            "isFinalized" = false,
            "updatedAt" = now()
      WHERE (league_player_weekly_scores.points, league_player_weekly_scores."rosterId",
             league_player_weekly_scores."isStarter", league_player_weekly_scores.source)
            IS DISTINCT FROM
            (EXCLUDED.points, EXCLUDED."rosterId", EXCLUDED."isStarter", EXCLUDED.source)`
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  return result
}
