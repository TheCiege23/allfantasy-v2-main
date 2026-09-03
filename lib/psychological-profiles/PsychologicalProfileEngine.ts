/**
 * PsychologicalProfileEngine — orchestrates signal aggregation, label resolution, evidence build, and persistence.
 */

import { prisma } from '@/lib/prisma'
import { aggregateBehaviorSignals } from './BehaviorSignalAggregator'
import { resolveProfileLabels, resolveScores } from './ProfileLabelResolver'
import { buildEvidenceFromSignals } from './ProfileEvidenceBuilder'
import { normalizeSportForPsych, isSupportedPsychSport } from './SportBehaviorResolver'
import { writeProfileSeasonSnapshot } from './ProfileSeasonSnapshot'
import { summarizeEvidence } from './ProfileEvidenceFloor'
import type { ProfileLabel } from './types'

/**
 * The three evidence-floor categories as numbers, for the season snapshot's numeric column.
 *
 * ⚠ A STATED CONVENTION, NOT A MEASUREMENT. `summarizeEvidence` expresses confidence as
 * 'high' | 'moderate' | 'low' because that is what the evidence counts support; these values
 * exist only so seasons can be ordered and thresholded. Do not present them to a user as a
 * probability, and do not tune them — if a genuine numeric confidence appears upstream, replace
 * this map rather than adjusting the constants under it.
 */
const CONFIDENCE_BY_CATEGORY: Record<'high' | 'moderate' | 'low', number> = {
  high: 0.9,
  moderate: 0.6,
  low: 0.3,
}

export interface PsychEngineInput {
  leagueId: string
  managerId: string
  sport: string
  sleeperUsername?: string
  rosterId?: string
  season?: number | null
  /**
   * True when `season` was INVENTED by the caller rather than read from the league (R4b.2).
   *
   * 🛑 THE SNAPSHOT GUARD BELOW WAS UNREACHABLE WITHOUT THIS. `ProfileRefreshService` computes
   * `input.season ?? league?.season ?? new Date().getFullYear()`, so `season` is never null by the
   * time it arrives here and `if (input.season != null)` could never refuse anything. The refusal
   * was correct and structurally dead.
   *
   * ⚠ A SEPARATE FLAG RATHER THAN PASSING NULL, and the reason is the aggregator. Its
   * `seasonThrough()` filters `season <= n`, and a dynasty league carries FUTURE draft picks —
   * 2027s and 2028s are routine. Passing null drops that filter entirely and newly counts them,
   * which silently changes every signal. So the invented season still bounds the aggregation
   * exactly as before; only the SNAPSHOT decision changes.
   */
  seasonInferred?: boolean
}

export interface PsychEngineResult {
  profileId: string
  created: boolean
  labels: ProfileLabel[]
}

/**
 * Run the psychological profile engine for one manager: aggregate signals, resolve labels/scores, upsert profile, store evidence.
 */
export async function runPsychologicalProfileEngine(
  input: PsychEngineInput
): Promise<PsychEngineResult> {
  const sportNorm = normalizeSportForPsych(input.sport)
  if (!isSupportedPsychSport(sportNorm)) {
    throw new Error(`Unsupported sport for psychological profiles: ${input.sport}`)
  }

  const signals = await aggregateBehaviorSignals(input.leagueId, input.managerId, sportNorm ?? input.sport, {
    sleeperUsername: input.sleeperUsername,
    rosterId: input.rosterId,
    season: input.season,
  })

  const labels = resolveProfileLabels(signals)
  const scores = resolveScores(signals)

  const existing = await prisma.managerPsychProfile.findUnique({
    where: { leagueId_managerId: { leagueId: input.leagueId, managerId: input.managerId } },
    include: { evidence: true },
  })

  let profileId: string
  if (existing) {
    await prisma.managerPsychProfile.update({
      where: { id: existing.id },
      data: {
        sport: sportNorm ?? input.sport,
        profileLabels: labels,
        aggressionScore: scores.aggressionScore,
        activityScore: scores.activityScore,
        tradeFrequencyScore: scores.tradeFrequencyScore,
        waiverFocusScore: scores.waiverFocusScore,
        riskToleranceScore: scores.riskToleranceScore,
      },
    })
    await prisma.profileEvidenceRecord.deleteMany({ where: { profileId: existing.id } })
    profileId = existing.id
  } else {
    const created = await prisma.managerPsychProfile.create({
      data: {
        leagueId: input.leagueId,
        managerId: input.managerId,
        sport: sportNorm ?? input.sport,
        profileLabels: labels,
        aggressionScore: scores.aggressionScore,
        activityScore: scores.activityScore,
        tradeFrequencyScore: scores.tradeFrequencyScore,
        waiverFocusScore: scores.waiverFocusScore,
        riskToleranceScore: scores.riskToleranceScore,
      },
    })
    profileId = created.id
  }

  const evidencePayloads = buildEvidenceFromSignals(signals, profileId, input.season)

  // Evidence is derived wholly from the current signals, so a run REPLACES the
  // prior set rather than appending to it. This used to create a fresh row per
  // evidence type on every run, which was survivable while the engine was only
  // ever invoked by hand; now that a cron refreshes profiles after each sync it
  // would add thousands of rows a day per league and leave readers picking a
  // winner among stale duplicates.
  await prisma.profileEvidenceRecord.deleteMany({ where: { profileId } })
  if (evidencePayloads.length > 0) {
    await prisma.profileEvidenceRecord.createMany({
      data: evidencePayloads.map((ev) => ({
        managerId: ev.managerId,
        leagueId: ev.leagueId,
        sport: ev.sport,
        evidenceType: ev.evidenceType,
        value: ev.value,
        sourceReference: ev.sourceReference ?? undefined,
        ...(ev.createdAt ? { createdAt: ev.createdAt } : {}),
        profileId,
      })),
    })
  }

  /*
   * ── P1: RECORD THIS SEASON ALONGSIDE THE LIVE PROFILE ─────────────────────────────────────
   *
   * The row above is `@@unique([leagueId, managerId])` and was just overwritten, so without this
   * the previous reading is gone — "he was a rebuilder in 2023 and win-now since 2024" is not
   * unimplemented, it is unanswerable, and every refresh makes it more so.
   *
   * ⚠ AWAITED BUT NEVER FATAL. The snapshot is history, the profile is the product; a failure to
   * record the past must not fail the run that produced the present. `writeProfileSeasonSnapshot`
   * returns false rather than throwing, and that outcome is deliberately visible to a caller who
   * wants it rather than swallowed — the lesson from a cron that reported 400 writes it never made.
   *
   * ⚠ NO SEASON, NO SNAPSHOT — AND NO *INVENTED* SEASON EITHER (R4b.2). `input.season` is
   * optional, and inventing one — `new Date().getFullYear()` is the tempting line — would file a
   * dynasty league's cumulative history under whatever year the cron happened to run, which is
   * worse than having no history at all.
   *
   * 🛑 THAT IS EXACTLY WHAT THE CALLER DID, AND THIS GUARD COULD NOT SEE IT. `ProfileRefreshService`
   * writes `input.season ?? league?.season ?? new Date().getFullYear()`, so `season` was never null
   * here and `season != null` refused nothing, ever. The rule was right and structurally
   * unreachable — a guard is only as strong as the narrowest caller that reaches it, and checking
   * that a refusal is written correctly says nothing about whether any input can trigger it.
   *
   * `seasonInferred` is how the caller now admits the invention. The aggregation still uses the
   * invented year, deliberately — see the field's own note on why passing null there would change
   * every signal.
   */
  if (input.season != null && !input.seasonInferred) {
    const floor = summarizeEvidence(signals)
    await writeProfileSeasonSnapshot({
      leagueId: input.leagueId,
      managerId: input.managerId,
      sport: sportNorm ?? input.sport,
      // Not yet resolved — the format column is populated by R4b.1's backfill. Null is honest.
      format: null,
      season: input.season,
      labels,
      scores,
      sampleSize: evidencePayloads.length,
      /*
       * Null when nothing clears the floor: that season is recorded as HAPPENED but not as
       * MEASURED, which is what stops `summariseTrajectory` resting a change claim on it.
       *
       * ⚠ `overallConfidence` IS A CATEGORY ('high' | 'moderate' | 'low'), NOT A PROBABILITY, and
       * the column is numeric. The mapping below is a coarse, stated convention — three buckets
       * rendered as three numbers — NOT a measurement, and it must not be read as one. It exists
       * so the trajectory can order and threshold seasons; if a real numeric confidence ever
       * appears upstream, replace this rather than tuning the constants.
       */
      confidence: floor.anySufficient ? CONFIDENCE_BY_CATEGORY[floor.overallConfidence ?? 'low'] : null,
    })
  }

  return {
    profileId,
    created: !existing,
    labels,
  }
}
