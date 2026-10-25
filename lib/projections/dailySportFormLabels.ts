/**
 * Client-safe words for the daily-sport AF projection (dailySportForm.ts) — no imports, so a screen
 * can name the basis without bundling the normalizers.
 */

/** What every surface prints beside the number. */
export const AF_FORM_PROJECTION_LABEL = 'AF projection (recent form)'

/** `projectionsSource` on the wire for a row priced by the daily-sport outlook. */
export const AF_FORM_PROJECTION_SOURCE = 'allfantasy:projection_recent_form'

/** One sentence on what the number is, for a footnote. */
export const AF_FORM_PROJECTION_EXPLAINER =
  "AF projection from recent form: each player's recent per-game points in your league's scoring, leaning on last season's while this season's sample is small, × his team's games this period. Not a vendor projection."

/** Hover text for a position rank chip. */
export const AF_POSITION_RANK_TITLE = "Position rank by season fantasy points in your league's scoring"
