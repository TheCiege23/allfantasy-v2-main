import 'server-only'

import { prisma } from '@/lib/prisma'
import { rescoreIdpForLeague, type StoredProjectionFactors } from '@/lib/af-projections/rescoreForLeague'

/**
 * AF Projections → Decision OS facts (3.1).
 *
 * 🛑 DECISION OS READS. IT NEVER COMPUTES. This module does not call `buildAfProjection` and must
 * not learn how: D6 keeps the projection engine as a PRODUCER that writes `AFProjectionSnapshot`,
 * and the architecture freeze's rule — "Decision OS should decide, not gather" — is what stops the
 * substrate growing a second projection implementation beside the real one.
 *
 * CHECKED, NOT ASSUMED: the writer runs. `writeAfProjectionSnapshots` is called from
 * `/api/cron/compute-projections`, scheduled daily at 07:50 UTC. Reading a table nothing writes is
 * the `ingestCFBDStats` failure, and this plan has met three variants of it.
 *
 * ── ⚠ THE STORED ROW HOLDS EXACTLY ONE SCORING FORMAT, AND IT IS PROBABLY NOT YOURS ─────────
 * `AFProjectionSnapshot` is keyed `playerId|season|week|eventId` with no `scoringPresetId`, so it
 * physically holds ONE format per player. The writer stores a canonical `balanced` IDP projection.
 * That is correct for a balanced league and materially wrong for everyone else: a linebacker
 * projected at 9.06 tackles is worth ~9 points under `balanced` (solo 1.0 / assist 0.5) and
 * roughly DOUBLE under a tackle-heavy setup — which is why Sleeper shows top LBs at 18-20.
 *
 * So this is D4's rescore-at-read, and the mechanism already exists: the writer persists the
 * component AMOUNTS in `adjustmentFactors.idp.componentAmounts`, and `rescoreIdpForLeague` turns
 * them into points under whatever rules the asking league actually uses. No migration, no second
 * write, and a league's own settings always win.
 *
 * ⚠ A NULL RESCORE IS NOT A FAILURE. It means the stored value stands — older rows carry no
 * component amounts, non-IDP players have none to carry, and a league with no IDP rules has
 * nothing to rescore against. `rescoreForLeague` says so in its own words, and this layer must
 * not convert that into a gap or a zero.
 */

/** One projection, already correct for the league that asked (or honestly still canonical). */
export interface ProjectionFact {
  playerId: string
  playerName: string
  sport: string
  position: string
  season: number
  week: number | null

  /** The points this league should see. Equals `storedPoints` when no rescore applied. */
  points: number
  /** What the row holds, under the canonical preset the writer used. */
  storedPoints: number
  /**
   * True when league rules changed the number.
   *
   * ⚠ SURFACE THIS. "9.1 points under your league's rules" and "9.1 points under our default"
   * are different claims, and a reader who cannot tell them apart will assume the first.
   */
  rescored: boolean
  /** The preset the stored value was computed under. Null when the row does not say. */
  storedPreset: string | null
  /**
   * Components present in the projection that this league does NOT score.
   *
   * Named rather than silently dropped — a league that ignores `qbHit` should be able to see that
   * it ignored it, because the alternative is a quietly lower number with no explanation.
   */
  unscoredComponents: string[]

  /** The writer's own qualitative confidence. Deliberately NOT coerced to a number here. */
  confidenceLevel: string
  computedAt: string
  /** Null when the row carries no expiry; never invented. */
  validUntil: string | null
}

export interface ProjectionFactsArgs {
  sport: string
  season: number
  week?: number | null
  /**
   * This league's IDP rules, if it scores IDP. Absent means "do not rescore" — which is different
   * from "rescore against nothing" and must not be collapsed into an empty object.
   */
  leagueIdpRules?: Record<string, number> | null
  playerIds?: string[]
  limit?: number
}

/**
 * Load projections, rescored for the asking league where the data allows it.
 *
 * Returns [] rather than throwing. An empty array here means "no rows matched", which the caller
 * must not present as "this player has no projection" without checking that the writer has run —
 * `not_computed` and `no_producer` are separate answers and only the caller knows which it needs.
 */
export async function loadProjectionFacts(args: ProjectionFactsArgs): Promise<ProjectionFact[]> {
  const sport = args.sport.trim().toUpperCase()

  const rows = await prisma.aFProjectionSnapshot
    .findMany({
      where: {
        sport,
        season: args.season,
        ...(args.week != null ? { week: args.week } : {}),
        ...(args.playerIds?.length ? { playerId: { in: args.playerIds } } : {}),
      },
      orderBy: { computedAt: 'desc' },
      take: args.limit ?? 2000,
      select: {
        playerId: true, playerName: true, sport: true, position: true,
        season: true, week: true, afProjection: true, adjustmentFactors: true,
        confidenceLevel: true, computedAt: true, validUntil: true,
      },
    })
    .catch(() => [])

  return rows.map((row) => {
    const stored = row.afProjection
    const rescore = rescoreIdpForLeague(
      (row.adjustmentFactors ?? null) as StoredProjectionFactors | null,
      args.leagueIdpRules ?? null,
    )

    return {
      playerId: row.playerId,
      playerName: row.playerName,
      sport: row.sport,
      position: row.position,
      season: row.season,
      week: row.week ?? null,
      // A null rescore means the stored value stands — never a zero, never a gap.
      points: rescore ? rescore.points : stored,
      storedPoints: stored,
      rescored: rescore != null,
      storedPreset: rescore?.storedPreset ?? null,
      unscoredComponents: rescore?.unscoredComponents ?? [],
      confidenceLevel: row.confidenceLevel,
      computedAt: row.computedAt.toISOString(),
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    }
  })
}
