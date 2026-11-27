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

/**
 * "PG32" → "#32 PG": the server's compact position rank, read the way rankings are written
 * everywhere else ("#2 QB"). A label already in that shape, or one this does not recognise, is
 * returned as it is; empty → null.
 */
export function readablePositionRank(label: string | null | undefined): string | null {
  const raw = String(label ?? '').trim()
  if (!raw) return null
  const m = raw.match(/^([A-Za-z][A-Za-z/]*?)(\d+)$/)
  return m ? `#${Number(m[2])} ${m[1].toUpperCase()}` : raw
}
