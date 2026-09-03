import 'server-only'

import { prisma } from '@/lib/prisma'
import { rescoreIdpForLeague, type StoredProjectionFactors } from '@/lib/af-projections/rescoreForLeague'
import { rescoreKickerForLeague, type StoredKickerFactors } from '@/lib/af-projections/kickerScoring'

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
  /**
   * True when this league sets distance-based field-goal rules that the stored components cannot
   * honour exactly.
   *
   * ⚠ IT MEANS "RESCORED, BUT APPROXIMATED", which is a third state between `rescored: true` and
   * `rescored: false`. The projection stores makes and misses, not the yardage of each kick, so a
   * league paying 5 for 50+ and 3 for under is scored at its flat rate with this flag raised. A
   * reader that ignores it will present an approximation as exact.
   */
  kickerDistanceRulesIgnored: boolean

  /** The writer's own qualitative confidence. Deliberately NOT coerced to a number here. */
  confidenceLevel: string
  computedAt: string
  /** Null when the row carries no expiry; never invented. */
  validUntil: string | null

  /**
   * The stored component amounts, carried so a CACHED fact can still be rescored.
   *
   * 🛑 WITHOUT THIS FIELD THE FEED WOULD CACHE A LIE. `loadProjectionFacts` rescores inside
   * itself, so caching its output at app level would store ONE league's rescored points for
   * everybody — the exact defect 1.1b had to unpick in Waiver OS and Trade OS, where a source
   * declared `level: 'league'` and derived user-specific facts. Keeping the raw amounts on the
   * fact means the cached object is genuinely league-agnostic and the rescore happens at READ,
   * which is what D4 asks for.
   */
  factors: StoredProjectionFactors | null
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
  /**
   * This league's KICKER rules. Same contract as `leagueIdpRules`: absent means "do not rescore".
   *
   * 🛑 THIS ARGUMENT IS WHY EVERY KICKER WAS PRICED WITH THE WRONG RULES. The writer stores kicker
   * components and a `kickerRules` blob on every snapshot and carries a comment saying they are
   * "applied at READ time via `rescoreKickerForLeague`, exactly as IDP does". They were not:
   * `rescoreKickerForLeague` had ZERO consumers repo-wide, so the canonical 3 / −1 / 1 / −1 stood
   * in every league regardless of its own scoring. A league paying 5 for a 50-yarder got a number
   * computed as though it paid 3, silently and with a comment asserting otherwise.
   */
  leagueKickerRules?: Record<string, number> | null
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
    const factors = (row.adjustmentFactors ?? null) as StoredProjectionFactors | null

    /*
     * ⚠ AT MOST ONE OF THESE EVER FIRES, and it is the stored components that decide which — not
     * the position string. A row carries `idp.componentAmounts` or `kicker.componentAmounts`,
     * never both, so each rescorer returns null on the other's rows. Branching on `position`
     * instead would have to keep its own list of which strings are kickers and which are
     * defenders, and that list is exactly the kind that goes stale against the data.
     */
    const idpRescore = rescoreIdpForLeague(factors, args.leagueIdpRules ?? null)
    /*
     * ⚠ ONLY ASKED WHEN IDP DECLINED, so a row can never be scored twice. The two rescorers key on
     * different stored blobs — `idp.componentAmounts` and `kicker.componentAmounts` — and a row
     * carries at most one, so each returns null on the other's rows.
     */
    const kickerRescore = idpRescore
      ? null
      : rescoreKickerForLeague(
          factors as unknown as StoredKickerFactors | null,
          args.leagueKickerRules ?? null,
        )
    const rescore = idpRescore ?? kickerRescore

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
      /*
       * ⚠ ONLY THE IDP SHAPE CARRIES A PRESET. `KickerScoringBreakdown` has no `storedPreset` —
       * the kicker writer uses one fixed canonical rule set, not a named preset — so reading it
       * off the union would be a type error and inventing one would name a preset that does not
       * exist.
       */
      storedPreset: idpRescore?.storedPreset ?? null,
      unscoredComponents: rescore?.unscoredComponents ?? [],
      /*
       * ⚠ SURFACED RATHER THAN DROPPED. A league with distance-based field-goal rules cannot be
       * scored exactly from stored components — the projection knows makes and misses, not the
       * yardage of each — so `rescoreKickerForLeague` honours what it can and reports the rest.
       * Swallowing this would present an approximation as an exact rescore.
       */
      kickerDistanceRulesIgnored: kickerRescore?.distanceRulesIgnored ?? false,
      confidenceLevel: row.confidenceLevel,
      computedAt: row.computedAt.toISOString(),
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
      factors: (row.adjustmentFactors ?? null) as StoredProjectionFactors | null,
    }
  })
}

/**
 * Load the CANONICAL projections — no league rules, nothing league-specific.
 *
 * This is what a feed may cache at app level. `loadProjectionFacts` with rules is the read-time
 * path; this is the storable one, and the split is deliberate rather than a convenience wrapper.
 */
export function loadCanonicalProjectionFacts(
  /*
   * 🛑 BOTH RULE ARGUMENTS ARE OMITTED, AND THE SECOND WAS NEARLY MISSED. This omit is what makes
   * the result safe to cache across leagues: a caller physically cannot ask this function for
   * league-scored points. When `leagueKickerRules` was added, omitting only `leagueIdpRules` would
   * have left a door open to league-score a CACHED object — one league's kicker points served to
   * everybody, which is precisely the defect this split exists to prevent and the one the module
   * header describes 1.1b unpicking in Waiver OS and Trade OS.
   */
  args: Omit<ProjectionFactsArgs, 'leagueIdpRules' | 'leagueKickerRules'>,
): Promise<ProjectionFact[]> {
  return loadProjectionFacts({ ...args, leagueIdpRules: null, leagueKickerRules: null })
}

/**
 * Rescore already-loaded facts for one league. PURE — no IO, so it can run on a cached object.
 *
 * ⚠ FACTS WITH NO STORED COMPONENTS COME BACK UNCHANGED, NOT ZEROED. That is the same refusal
 * `rescoreIdpForLeague` makes: a null rescore means the stored value stands, which is the honest
 * outcome when there is nothing better to say.
 */
export function rescoreProjectionFacts(
  facts: readonly ProjectionFact[],
  leagueIdpRules: Record<string, number> | null | undefined,
): ProjectionFact[] {
  if (!leagueIdpRules) return [...facts]
  return facts.map((f) => {
    const r = rescoreIdpForLeague(f.factors, leagueIdpRules)
    if (r) {
      return {
        ...f,
        points: r.points,
        rescored: true,
        storedPreset: r.storedPreset,
        unscoredComponents: r.unscoredComponents,
      }
    }

    /*
     * 🛑 KICKERS, ON THE SAME MAP — AND THIS IS THE PATH THAT ACTUALLY REACHES A USER.
     *
     * `rescoreKickerForLeague` had ZERO consumers repo-wide while `writeAfProjectionSnapshots`
     * carried a comment saying kicker rules "are applied at READ time via
     * `rescoreKickerForLeague`, exactly as IDP does". They were not. Every kicker in every league
     * was scored with the canonical 3 / −1 / 1 / −1, so a league paying 5 for a made field goal
     * got a number computed as though it paid 3 — silently, with a comment asserting otherwise.
     *
     * ⚠ THE SAME `leagueIdpRules` MAP IS CORRECT HERE, MISLEADING NAME NOTWITHSTANDING.
     * `deriveIdpRules` returns ALL of a league's active rules rather than an IDP-filtered subset —
     * it says so in its own header, and deliberately, because filtering by category risked
     * dropping a real rule an importer spelled differently. So the kicker keys are already in this
     * map, and `COMPONENT_RULE_KEYS` handles the spellings (`fgm` / `kick_fgm` /
     * `field_goal_made`). Deriving a second map would be a second implementation of "what does
     * this league score".
     *
     * ⚠ ASKED ONLY WHEN IDP DECLINED, so a row is never scored twice. The two rescorers key on
     * different stored blobs and a row carries at most one.
     */
    const k = rescoreKickerForLeague(
      f.factors as unknown as StoredKickerFactors | null,
      leagueIdpRules,
    )
    if (!k) return f
    return {
      ...f,
      points: k.points,
      rescored: true,
      // No preset: the kicker writer uses one fixed canonical rule set, not a named preset.
      unscoredComponents: k.unscoredComponents,
      kickerDistanceRulesIgnored: k.distanceRulesIgnored,
    }
  })
}
