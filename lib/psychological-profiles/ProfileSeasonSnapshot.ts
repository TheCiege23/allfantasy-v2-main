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
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "manager_psych_profile_seasons" (
        "id", "leagueId", "managerId", "sport", "format", "season",
        "profileLabels", "aggressionScore", "activityScore", "tradeFrequencyScore",
        "waiverFocusScore", "riskToleranceScore", "sampleSize", "confidence", "computedAt"
      ) VALUES (
        ${id}, ${input.leagueId}, ${input.managerId}, ${input.sport}, ${input.format}, ${input.season},
        ${JSON.stringify(input.labels)}::jsonb,
        ${input.scores.aggressionScore ?? 0}, ${input.scores.activityScore ?? 0},
        ${input.scores.tradeFrequencyScore ?? 0}, ${input.scores.waiverFocusScore ?? 0},
        ${input.scores.riskToleranceScore ?? 0},
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
  aggressionScore: number
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
export async function readManagerTrajectory(args: {
  leagueId: string
  managerId: string
}): Promise<TrajectoryPoint[]> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        season: number
        profileLabels: unknown
        aggressionScore: number
        sampleSize: number
        confidence: number | null
      }>
    >(Prisma.sql`
      SELECT "season", "profileLabels", "aggressionScore", "sampleSize", "confidence"
      FROM "manager_psych_profile_seasons"
      WHERE "leagueId" = ${args.leagueId} AND "managerId" = ${args.managerId}
      ORDER BY "season" ASC
    `)
    return rows.map((r) => ({
      season: Number(r.season),
      labels: Array.isArray(r.profileLabels) ? (r.profileLabels as string[]) : [],
      aggressionScore: Number(r.aggressionScore),
      sampleSize: Number(r.sampleSize),
      confidence: r.confidence == null ? null : Number(r.confidence),
    }))
  } catch {
    // An absent trajectory is a real answer — "nothing recorded yet" — not an error.
    return []
  }
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
  const delta = Math.round(last.aggressionScore - first.aggressionScore)
  const move = delta === 0 ? 'no change in aggression' : `aggression ${delta > 0 ? '+' : ''}${delta}`
  return {
    hasTrajectory: true,
    seasonsRecorded: points.length,
    summary: `${first.season}: ${was} → ${last.season}: ${now} (${move}, across ${usable.length} graded seasons).`,
  }
}
