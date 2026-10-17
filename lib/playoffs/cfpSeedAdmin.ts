import "server-only"
import { prisma } from "@/lib/prisma"
import {
  cfpSeedCorrections,
  readCfpSeeds,
  validateCfpSeeds,
  writeCfpSeeds,
  type CfpSeedsRecord,
} from "./cfpSeeds"
import { applyPlayoffSeedsToChallenges, type ApplyPlayoffSeedsSweep } from "./playoffSeeding"

/**
 * The admin action behind /admin/cfp-seeding: save the twelve seeds, then
 * seed every College Football Playoff pool for that season.
 *
 * Order, and why:
 *   1. validate                 — nothing is written from a bad list
 *   2. refuse late corrections  — see below
 *   3. save the seeds           — the source of truth, before any pool changes
 *   4. apply corrections        — renames of names an EARLIER save wrote
 *   5. seed placeholders        — the shared seeding path, idempotent
 * A failure after (3) is recoverable by saving again: every later step is
 * idempotent.
 */

export type CfpSeedSaveResult =
  | {
      ok: true
      record: CfpSeedsRecord
      pools: number
      corrections: Array<{ seed: number; from: string; to: string }>
      corrected: { slotsRenamed: number; picksRenamed: number }
      sweep: ApplyPlayoffSeedsSweep
    }
  | { ok: false; errors: string[] }

export async function saveCfpSeedsAndApply(input: {
  season: number
  seeds: unknown
  userId: string | null
}): Promise<CfpSeedSaveResult> {
  if (!Number.isInteger(input.season) || input.season < 2024 || input.season > 2100) {
    return { ok: false, errors: ["Season must be a year (the 2026 season's playoff is season 2026)."] }
  }
  const checked = validateCfpSeeds(input.seeds)
  if (!checked.ok) return checked

  const previous = await readCfpSeeds(input.season)
  const corrections = cfpSeedCorrections(previous?.seeds ?? null, checked.seeds)

  const pools = (await (prisma as any).playoffBracketChallenge.findMany({
    where: { sport: "ncaaf", seasonYear: input.season },
    select: { id: true },
  })) as Array<{ id: string }>
  const poolIds = pools.map((p) => p.id)

  /*
   * 🛑 NO CORRECTIONS ONCE A GAME HAS STARTED. Before kickoff a correction only
   * moves names and the picks that follow them. After it, results and scored
   * picks name the old team — rewriting those is editing history people have
   * points for, which is a support decision, not a form submission.
   */
  if (corrections.length > 0 && poolIds.length > 0) {
    const started = await (prisma as any).playoffBracketSeries.count({
      where: { challengeId: { in: poolIds }, status: { in: ["in_progress", "final"] } },
    })
    if (started > 0) {
      return {
        ok: false,
        errors: [
          `A CFP game has already started in at least one pool, so seeds can no longer be corrected here (${corrections
            .map((c) => `#${c.seed} ${c.from} → ${c.to}`)
            .join(", ")}).`,
        ],
      }
    }
  }

  const record = await writeCfpSeeds({ season: input.season, seeds: checked.seeds, userId: input.userId })
  const corrected =
    corrections.length > 0 && poolIds.length > 0
      ? await applyCfpSeedCorrections(poolIds, corrections)
      : { slotsRenamed: 0, picksRenamed: 0 }
  const sweep = await applyPlayoffSeedsToChallenges(poolIds)

  return { ok: true, record, pools: poolIds.length, corrections, corrected, sweep }
}

/**
 * Rename corrected teams everywhere they appear, picks included, per pool in
 * one transaction.
 *
 * ⚠ SWAPS ARE WHY THIS IS TWO-PHASE. Correcting seeds 5 and 6 that were
 * entered the wrong way round renames "Texas"→"Penn State" and
 * "Penn State"→"Texas". Done one at a time, the first rename makes two
 * "Penn State"s and the second can no longer tell them apart. Series columns
 * are remapped in memory (simultaneous by construction); picks are moved
 * through unique tokens first, then to their final names.
 *
 * Picks follow the SLOT, exactly as the placeholder rename does: a pick of the
 * team in seed 5's slot stays a pick of whoever is in seed 5's slot.
 */
export async function applyCfpSeedCorrections(
  poolIds: string[],
  corrections: Array<{ from: string; to: string }>,
): Promise<{ slotsRenamed: number; picksRenamed: number }> {
  const rename = new Map(corrections.map((c) => [c.from, c.to]))
  const token = (i: number) => `__cfp_seed_correction_${i}__`
  let slotsRenamed = 0
  let picksRenamed = 0

  for (const challengeId of poolIds) {
    const series = (await (prisma as any).playoffBracketSeries.findMany({
      where: { challengeId },
      select: { id: true, homeTeamName: true, awayTeamName: true, winnerTeamName: true },
    })) as Array<{ id: string; homeTeamName: string; awayTeamName: string; winnerTeamName: string | null }>
    const seriesIds = series.map((s) => s.id)

    const result = await prisma.$transaction(async (tx) => {
      let slots = 0
      for (const row of series) {
        const data: Record<string, string> = {}
        for (const column of ["homeTeamName", "awayTeamName", "winnerTeamName"] as const) {
          const current = row[column]
          if (current && rename.has(current)) data[column] = rename.get(current)!
        }
        const changed = Object.keys(data).length
        if (changed > 0) {
          await (tx as any).playoffBracketSeries.update({ where: { id: row.id }, data })
          slots += changed
        }
      }
      let picks = 0
      // Phase 1: every corrected name to a unique token. Phase 2: token to its final name.
      for (const [i, c] of corrections.entries()) {
        const moved = await (tx as any).playoffBracketPick.updateMany({
          where: { seriesId: { in: seriesIds }, pickTeamName: c.from },
          data: { pickTeamName: token(i) },
        })
        picks += moved.count ?? 0
      }
      for (const [i, c] of corrections.entries()) {
        await (tx as any).playoffBracketPick.updateMany({
          where: { seriesId: { in: seriesIds }, pickTeamName: token(i) },
          data: { pickTeamName: c.to },
        })
      }
      return { slots, picks }
    })
    slotsRenamed += result.slots
    picksRenamed += result.picks
  }

  return { slotsRenamed, picksRenamed }
}
