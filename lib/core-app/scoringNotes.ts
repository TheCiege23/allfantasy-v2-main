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

/** Positions the vendor's generic PPR line does not score at all. */
const IDP_POSITIONS = new Set([
  'DL', 'DE', 'DT', 'LB', 'ILB', 'OLB', 'MLB', 'DB', 'CB', 'S', 'SS', 'FS', 'IDP_FLEX',
])

/**
 * Long-form spellings the player cache actually stores.
 *
 * ⚠ THE COLUMN IS NOT ALL ABBREVIATIONS, AND THE ONES IT SPELLS OUT WENT MISSING. Measured
 * 2026-08-26: 583 of 15,043 NFL players carrying a Sleeper id have a long-form `position`, and
 * ~74 of those are defenders — `Linebacker`, `Cornerback`, `Defensive End`, `Safety`,
 * `Outside Linebacker`, `Defensive Lineman`. Matching the abbreviation set alone made every one
 * of them a non-defender, which is not a display bug: they were dropped from the league's VORP
 * board entirely, and `loadSnapShares` read them off the OFFENSIVE snap columns, where a
 * linebacker's number is special-teams noise.
 *
 * Foye Oluokun and Jessie Bates are both in this set, so it is not a tail of obscure names.
 */
const IDP_LONG_FORM = new Set([
  'LINEBACKER', 'OUTSIDE LINEBACKER', 'INSIDE LINEBACKER', 'MIDDLE LINEBACKER',
  'CORNERBACK', 'SAFETY', 'FREE SAFETY', 'STRONG SAFETY', 'DEFENSIVE BACK',
  'DEFENSIVE END', 'DEFENSIVE TACKLE', 'DEFENSIVE LINEMAN', 'EDGE RUSHER', 'NOSE TACKLE',
])

export function isIdpPosition(position: string | null | undefined): boolean {
  const raw = (position ?? '').trim().toUpperCase()
  return IDP_POSITIONS.has(raw) || IDP_LONG_FORM.has(raw)
}

/**
 * Does this league score individual defensive players?
 *
 * ⚠ IF IT DOES, THE VENDOR'S GENERIC NUMBER IS NOT A WORSE ESTIMATE FOR A
 * LINEBACKER — IT IS NOT AN ESTIMATE OF ANYTHING. The generic line is standard
 * PPR, which contains no defensive scoring whatsoever, so it returns whatever
 * incidental offensive stats a defender is projected for: a fumble return, a
 * receiving yard. Measured against a real IDP league, that produced 0.3 for a
 * linebacker the league projects at 18. Printing 0.3 is the fake-zero mistake
 * with extra steps.
 */
export function hasIdpScoring(scoring: Record<string, unknown> | null | undefined): boolean {
  if (!scoring || typeof scoring !== 'object') return false
  return Object.keys(scoring).some(
    (k) => IDP_ONLY_SCORING_KEY(k) && (num(scoring[k]) ?? 0) !== 0,
  )
}

/**
 * Is this a scoring key that can ONLY belong to an individual defender?
 *
 * ⚠ BARE `sack` / `int` / `ff` / `fum_rec` / `safe` DO NOT COUNT, AND THIS IS THE WHOLE
 * POINT OF THE FUNCTION. Those are the TEAM-DEFENSE settings that every Sleeper league
 * ships by default, so treating them as evidence of IDP classifies almost the entire
 * product as an IDP league.
 *
 * Measured on production 2026-08-25, across 110 leagues (81 with readable scoring):
 *   - counting the bare DEF keys:        64 leagues "score IDP"
 *   - requiring a genuinely IDP-only key: 10 leagues
 *   - of 11 sampled false positives, ZERO rostered a single defender.
 *
 * The earlier, looser version was wrong in both directions it could be wrong in. It told 54
 * leagues that they "score individual defensive players" in `describeScoringDifferences`,
 * which is a false statement shown to a manager; and it suppressed a defender's generic
 * projection to an em dash in leagues that do not roster defenders at all.
 *
 * (The "54 of 120" figure in `STAT_ALIASES` is the same population and is NOT an IDP count —
 * it measures leagues carrying bare `sack`/`int`/`ff`/`fum_rec`, which is exactly the
 * team-defense default this function now excludes.)
 *
 * Tackle keys are kept in their bare form on purpose: a team defense has no `tkl_solo`
 * setting, so those cannot be confused for a DEF-unit rule.
 */
const IDP_ONLY_BARE_KEYS = new Set(['tkl', 'tkl_solo', 'tkl_ast', 'tkl_loss'])
const IDP_ONLY_SCORING_KEY = (k: string): boolean =>
  k.startsWith('idp_') || IDP_ONLY_BARE_KEYS.has(k)

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
