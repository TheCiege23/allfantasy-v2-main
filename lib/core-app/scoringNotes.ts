/**
 * Why this league's projection differs from the generic one.
 *
 * The vendor ships `projectedPoints` already collapsed under a standard PPR
 * preset. Re-scoring the same component line under a league's own
 * `scoring_settings` produces a different number, and a manager looking at two
 * different numbers deserves to know which rule caused the gap rather than
 * being asked to take it on trust.
 *
 * ⚠ EVERY NOTE HERE IS READ OFF THE LEAGUE'S OWN SETTINGS. Nothing is inferred
 * from a league name, a format label, or what leagues "usually" do. If a
 * setting is absent this says nothing about it, because an absent key means the
 * league did not record it — not that it uses the default.
 *
 * Deliberately client-safe: no `server-only`, no Prisma. The screen renders
 * these and the same strings seed the question sent to Chimmy.
 */

/** Sleeper's standard full-PPR values, which the vendor number is built on. */
const PPR_BASELINE: Record<string, number> = {
  rec: 1,
  pass_td: 4,
  pass_int: -2,
  fum_lost: -2,
  rec_td: 6,
  rush_td: 6,
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : null
  return n == null || Number.isNaN(n) ? null : n
}

/** Trim a float for prose: 1.5 stays 1.5, 1.0 becomes 1. */
function tidy(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/**
 * Human-readable reasons this league scores differently from generic PPR.
 *
 * Returns an empty array when the league really is standard PPR — in which case
 * the two projections should agree, and saying "no differences" is the honest
 * and useful answer.
 */
export function describeScoringDifferences(
  scoring: Record<string, unknown> | null | undefined,
): string[] {
  if (!scoring || typeof scoring !== 'object') return []
  const notes: string[] = []

  const rec = num(scoring.rec)
  if (rec != null && rec !== PPR_BASELINE.rec) {
    notes.push(
      rec === 0
        ? 'Receptions are worth nothing here — this is standard scoring, not PPR.'
        : `Receptions are worth ${tidy(rec)}, not 1.`,
    )
  }

  // TE premium is the single most common reason a tight end's two numbers
  // diverge, and it is invisible in the generic figure.
  const teBonus = num(scoring.bonus_rec_te)
  if (teBonus != null && teBonus !== 0) {
    notes.push(`Tight ends get an extra ${tidy(teBonus)} per catch on top.`)
  }

  const passTd = num(scoring.pass_td)
  if (passTd != null && passTd !== PPR_BASELINE.pass_td) {
    notes.push(`Passing touchdowns are worth ${tidy(passTd)}, not 4.`)
  }

  const passInt = num(scoring.pass_int)
  if (passInt != null && passInt !== PPR_BASELINE.pass_int) {
    notes.push(`Interceptions cost ${tidy(Math.abs(passInt))}, not 2.`)
  }

  const bonusKeys = Object.keys(scoring).filter(
    (k) => k.startsWith('bonus_') && k !== 'bonus_rec_te' && (num(scoring[k]) ?? 0) !== 0,
  )
  if (bonusKeys.length > 0) {
    notes.push(
      `${bonusKeys.length} yardage or milestone ${
        bonusKeys.length === 1 ? 'bonus applies' : 'bonuses apply'
      } that generic scoring ignores.`,
    )
  }

  /*
   * IDP is the largest possible divergence: the vendor's PPR number contains no
   * defensive scoring at all, so for a defensive player the generic figure is
   * not merely different, it is meaningless.
   */
  const idpKeys = Object.keys(scoring).filter(
    (k) =>
      (k.startsWith('idp_') || ['tkl', 'tkl_solo', 'tkl_ast', 'sack', 'int', 'ff', 'fr'].includes(k)) &&
      (num(scoring[k]) ?? 0) !== 0,
  )
  if (idpKeys.length > 0) {
    notes.push(
      'This league scores individual defensive players, which the generic number does not count at all.',
    )
  }

  return notes
}

/**
 * The question to hand Chimmy when the manager asks why the numbers differ.
 *
 * Seeded, never sent: see the note on COMMS_OPEN_EVENT. It is phrased as the
 * user's own question because that is whose composer it lands in.
 */
export function buildProjectionQuestion(leagueName: string, week: number | null): string {
  const wk = week != null ? ` in week ${week}` : ''
  return `Why is the AllFantasy projection for my ${leagueName} lineup${wk} different from the standard projection? Break down which of my league's scoring rules cause the gap, and which players it moves the most.`
}
