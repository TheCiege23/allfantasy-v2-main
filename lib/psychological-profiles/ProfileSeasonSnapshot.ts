import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Per-season psychology snapshots — the half of a profile that makes a TRAJECTORY possible (P1).
 *
 * ── 🛑 WHY THIS EXISTS: THE PROFILE IS ONE ROW, OVERWRITTEN ──────────────────────────────────
 * `manager_psych_profiles` is `@@unique([leagueId, managerId])` and every refresh upserts it. So
 * "he was a patient rebuilder in 2023 and has been win-now since 2024" was not an unimplemented
 * feature — it was **unanswerable from the data as stored**, and every refresh actively destroyed
 * the previous reading. `BehaviorSignalAggregator.seasonThrough()` uses `season <= n` on purpose
 * (a dynasty league carries picks under 2021-2025, so exact equality returns nothing), which is
 * correct for a cumulative headline and useless for direction.
 *
 * This table is written ALONGSIDE the live profile, never instead of it. Every existing reader of
 * `manager_psych_profiles` is untouched.
 *
 * ── ⚠ RAW SQL, NOT A PRISMA DELEGATE, AND IT IS A DELIBERATE CHOICE ─────────────────────────
 * A `model` in `schema.prisma` only produces a delegate after someone runs `prisma generate`, and
 * regenerating rewrites shared `node_modules` under every running `tsc` — it took this machine
 * down once already tonight and needed a sessions-wide freeze.
 *
 * Worse, an ungenerated client reproduces EXACTLY the `domain_os_facts` failure this session spent
 * hours fixing: `delegateOf(db)` returns undefined, every write silently no-ops, and the caller
 * cannot tell the difference from success. Raw SQL works the instant the table exists — which it
 * does, applied by the owner 2026-09-02 and verified by `information_schema` (15 columns, 4
 * indexes) — and it needs no coordination with any other session.
 *
 * ⚠ `Prisma.sql` TAGGED TEMPLATES ONLY. Every value below is a parameter, never interpolated.
 * `managerId` and `leagueId` are user-adjacent, and this file is the one place in the psychology
 * stack that writes SQL by hand.
 */

export type SeasonScores = {
  aggressionScore: number | null
  activityScore: number | null
  tradeFrequencyScore: number | null
  waiverFocusScore: number | null
  riskToleranceScore: number | null
}

export interface SeasonSnapshotInput {
  leagueId: string
  managerId: string
  sport: string
  /** dynasty | redraft | keeper | … Null = not yet resolved, which is honest, not a default. */
  format: string | null
  season: number
  labels: string[]
  scores: SeasonScores
  sampleSize: number
  /** Null = below the evidence floor. NEVER zero — see the column comment in the migration. */
  confidence: number | null
}

/**
 * Write (or replace) one manager's snapshot for one season.
 *
 * 🛑 ON CONFLICT IS LOAD-BEARING, NOT DEFENSIVE. The profile refresh runs on the 30-minute
 * exec-sync heartbeat. Without the upsert this table would grow a row per fire and a two-season
 * trajectory would read as several hundred identical "seasons" — a graph of noise that looks like
 * data.
 *
 * ⚠ RETURNS A BOOLEAN, for the same reason `OsStore.write` now does: a writer that cannot report
 * failure is a writer that lies, and this codebase has already paid for that once with a cron
 * announcing 400 writes it never made. The caller decides what to do about it; this function will
 * not fail the refresh that produced the data.
 */
export async function writeProfileSeasonSnapshot(input: SeasonSnapshotInput): Promise<boolean> {
  try {
    const id = `${input.leagueId}:${input.managerId}:${input.season}`
    /*
     * 🛑 THE FIVE SCORES ARE PASSED RAW — NO `?? 0` — R4b.3. They were previously coalesced to
     * zero on the way into NOT NULL columns, which stored "never measured" as "measured, and the
     * answer was zero": a manager never assessed for aggression was recorded as maximally
     * passive. Measured on the first 97 production rows, 68 carried a non-zero aggression score
     * and nothing distinguished the other 29 from genuinely passive managers.
     *
     * That is the same failure the evidence floor exists to prevent, and it is already handled
     * correctly one module over — `PsychologyProfileFact.scores` is `number | null` for exactly
     * this reason. Null is the honest value and the columns now permit it.
     *
     * ⚠ DO NOT WRITE THIS EXPLANATION INSIDE THE TEMPLATE BELOW. A block comment in a tagged
     * template is not a comment, it is literal SQL text — and any `${…}` inside it is a live
     * interpolation. Putting this note there was a parse error, which is the cheap version of
     * the failure; the expensive version silently injects prose into a query.
     */
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "manager_psych_profile_seasons" (
        "id", "leagueId", "managerId", "sport", "format", "season",
        "profileLabels", "aggressionScore", "activityScore", "tradeFrequencyScore",
        "waiverFocusScore", "riskToleranceScore", "sampleSize", "confidence", "computedAt"
      ) VALUES (
        ${id}, ${input.leagueId}, ${input.managerId}, ${input.sport}, ${input.format}, ${input.season},
        ${JSON.stringify(input.labels)}::jsonb,
        ${input.scores.aggressionScore}, ${input.scores.activityScore},
        ${input.scores.tradeFrequencyScore}, ${input.scores.waiverFocusScore},
        ${input.scores.riskToleranceScore},
        ${input.sampleSize}, ${input.confidence}, NOW()
      )
      ON CONFLICT ("leagueId", "managerId", "season") DO UPDATE SET
        "sport" = EXCLUDED."sport",
        "format" = EXCLUDED."format",
        "profileLabels" = EXCLUDED."profileLabels",
        "aggressionScore" = EXCLUDED."aggressionScore",
        "activityScore" = EXCLUDED."activityScore",
        "tradeFrequencyScore" = EXCLUDED."tradeFrequencyScore",
        "waiverFocusScore" = EXCLUDED."waiverFocusScore",
        "riskToleranceScore" = EXCLUDED."riskToleranceScore",
        "sampleSize" = EXCLUDED."sampleSize",
        "confidence" = EXCLUDED."confidence",
        "computedAt" = NOW()
    `)
    return true
  } catch {
    // Never fail the refresh that produced the data. Reported, not swallowed silently.
    return false
  }
}

export interface TrajectoryPoint {
  season: number
  labels: string[]
  /**
   * ⚠ NULLABLE, AND `Number(null)` IS `0` — R4b.3. This was typed `number` and mapped with a bare
   * `Number(...)`, which is a SECOND, quieter place the same null died: even once the writer and
   * the column preserved it, the read turned "unmeasured" back into "zero" on the way out.
   *
   * Null here means the score was never measured for that season. It is NOT a low score, and it
   * must never be coerced into one — see `summariseTrajectory`, which refuses to compute a delta
   * across it rather than treating it as 0 and inventing a swing.
   */
  aggressionScore: number | null
  /** Observations behind the snapshot. NOT nullable — zero observations is a real answer. */
  sampleSize: number
  /** Null = that season never cleared its evidence floor. Not a low score — an absent one. */
  confidence: number | null
}

/**
 * One manager's recorded seasons, OLDEST FIRST.
 *
 * ⚠ The order is the point. A reader handed newest-first sees a list; handed oldest-first, sees a
 * direction. Since the whole reason this table exists is direction, the ordering is part of the
 * contract rather than a display preference.
 */
type SeasonRow = {
  season: number
  profileLabels: unknown
  aggressionScore: number | null
  sampleSize: number
  confidence: number | null
}

/** The one place a raw season row becomes a `TrajectoryPoint` — shared so the per-manager and
 *  league-wide readers cannot drift on the null-handling (R4b.3's lesson, twice already: `??` on
 *  the way in, bare `Number()` on the way out). */
function toTrajectoryPoint(r: SeasonRow): TrajectoryPoint {
  return {
    season: Number(r.season),
    labels: Array.isArray(r.profileLabels) ? (r.profileLabels as string[]) : [],
    // ⚠ `Number(null)` is 0, not NaN — a bare Number() here silently resurrects the exact bug
    // the column change was made to fix. Guard before converting, the same way `confidence` does.
    aggressionScore: r.aggressionScore == null ? null : Number(r.aggressionScore),
    sampleSize: Number(r.sampleSize),
    confidence: r.confidence == null ? null : Number(r.confidence),
  }
}

export async function readManagerTrajectory(args: {
  leagueId: string
  managerId: string
}): Promise<TrajectoryPoint[]> {
  try {
    const rows = await prisma.$queryRaw<SeasonRow[]>(Prisma.sql`
      SELECT "season", "profileLabels", "aggressionScore", "sampleSize", "confidence"
      FROM "manager_psych_profile_seasons"
      WHERE "leagueId" = ${args.leagueId} AND "managerId" = ${args.managerId}
      ORDER BY "season" ASC
    `)
    return rows.map(toTrajectoryPoint)
  } catch {
    // An absent trajectory is a real answer — "nothing recorded yet" — not an error.
    return []
  }
}

/**
 * Every recorded manager's trajectory for one league, in a SINGLE query rather than one per
 * manager. R4b.5 — the psychology packet slice reports on every manager in the league (typically
 * 8-14), and `readManagerTrajectory` in a loop would be an N+1 query pattern for something the
 * 12h-TTL feed cache is about to amortise anyway. Same row shape, same null-handling, one round
 * trip.
 */
export async function readLeagueTrajectories(leagueId: string): Promise<Map<string, TrajectoryPoint[]>> {
  const out = new Map<string, TrajectoryPoint[]>()
  try {
    const rows = await prisma.$queryRaw<Array<SeasonRow & { managerId: string }>>(Prisma.sql`
      SELECT "managerId", "season", "profileLabels", "aggressionScore", "sampleSize", "confidence"
      FROM "manager_psych_profile_seasons"
      WHERE "leagueId" = ${leagueId}
      ORDER BY "managerId" ASC, "season" ASC
    `)
    for (const r of rows) {
      const point = toTrajectoryPoint(r)
      const existing = out.get(r.managerId)
      if (existing) existing.push(point)
      else out.set(r.managerId, [point])
    }
  } catch {
    // Empty map is the same honest "nothing recorded yet" as readManagerTrajectory's [].
  }
  return out
}

export interface TrajectorySummary {
  hasTrajectory: boolean
  summary: string
  seasonsRecorded: number
}

/**
 * Turn recorded seasons into a statement about CHANGE — or refuse.
 *
 * ── 🛑 TWO REFUSALS, AND BOTH ARE THE POINT ─────────────────────────────────────────────────
 *
 * 1. ONE SEASON IS NOT A TRAJECTORY. A single point has no direction, and calling it a trend is
 *    the same error `CrossLeagueRollup` already refuses on the league axis: "a label seen once is
 *    an observation that happens to have been rolled up". Same rule, different axis.
 *
 * 2. A SEASON WITH NULL CONFIDENCE CANNOT BE ONE END OF A CHANGE CLAIM. Null means that season
 *    never cleared its evidence floor — so "he went from rebuilder to win-now" resting on it is a
 *    claim about a reading that was explicitly not trustworthy. Filtering these out is P6 applied
 *    to the time axis, and it is why a manager with two recorded seasons can still honestly have
 *    NO trajectory.
 *
 * ⚠ PURE. No IO, no clock — so what a prompt is told is assertable in a test.
 */
export function summariseTrajectory(points: TrajectoryPoint[]): TrajectorySummary {
  const usable = points.filter((p) => p.confidence != null)
  if (usable.length < 2) {
    return {
      hasTrajectory: false,
      seasonsRecorded: points.length,
      summary:
        points.length === 0
          ? 'No season history has been recorded for this manager yet.'
          : `Only one season clears the evidence floor (${points.length} recorded), so there is no direction to report yet.`,
    }
  }
  const first = usable[0]
  const last = usable[usable.length - 1]
  const was = first.labels.length ? first.labels.join(', ') : 'unlabelled'
  const now = last.labels.length ? last.labels.join(', ') : 'unlabelled'

  /*
   * 🛑 A NULL END CANNOT ANCHOR A DELTA — and JavaScript will happily pretend otherwise.
   * `null - 5` is `-5`, not NaN, so the previous `last.aggressionScore - first.aggressionScore`
   * would have reported a confident "aggression -5" for a season whose aggression was never
   * measured. Clearing the evidence floor (`confidence != null`) does NOT imply every individual
   * score was measured, so this guard is load-bearing rather than defensive.
   *
   * ⚠ The trajectory itself SURVIVES an unmeasured score. A label change is direction on its own,
   * so only the aggression clause is withheld — refusing the whole summary here would throw away
   * the answer the caller actually asked for.
   */
  const firstAggr = first.aggressionScore
  const lastAggr = last.aggressionScore
  let move: string
  if (firstAggr == null || lastAggr == null) {
    move = 'aggression not measured in both seasons'
  } else {
    const delta = Math.round(lastAggr - firstAggr)
    move = delta === 0 ? 'no change in aggression' : `aggression ${delta > 0 ? '+' : ''}${delta}`
  }
  return {
    hasTrajectory: true,
    seasonsRecorded: points.length,
    summary: `${first.season}: ${was} → ${last.season}: ${now} (${move}, across ${usable.length} graded seasons).`,
  }
}
