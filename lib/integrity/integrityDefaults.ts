/**
 * What a league's integrity settings start as, when nobody has chosen yet.
 *
 * ⚠ THE TANKING MONITOR SHIPPED OFF, AND NOBODY EVER TURNED IT ON. `LeagueIntegritySettings`
 * defaults `tankingMonitorEnabled` to false in the schema; measured 2026-11-06, 0 of 18 leagues with a
 * settings row had it on and production had never raised a tanking flag. Owner decision the same day:
 * on by default.
 *
 * It starts at week 4 because early-season lineup mistakes are usually inexperience, not tanking, and
 * a monitor that flags week 2 trains commissioners to ignore it. Nothing is taken from anyone on a
 * flag: a flag warns the manager privately, and a penalty needs the commissioner to confirm the case.
 * Scanning still needs AF Commissioner; on a league without it these values are simply stored.
 *
 * Applied in code, not as a schema default, so it needs no migration: every path that CREATES a
 * settings row spreads this first and lets an explicit choice override it. A row that already exists
 * is never changed by it — those are the commissioner's to switch.
 */
export const NEW_LEAGUE_INTEGRITY_DEFAULTS = {
  tankingMonitorEnabled: true,
  tankingStartWeek: 4,
} as const
