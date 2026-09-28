/**
 * A stored manager or team name, or null when what is stored is a placeholder rather than a name.
 *
 * 🛑 SEVERAL IMPORTERS WRITE THE WORD "Unknown" WHERE A NAME WAS MISSING (`syncLeagueHistory`,
 * `history-aggregates`, `normalize`, and others), and the Core surfaces printed it as if it were a
 * manager: "UNKNOWN SENT" on the Trades board and "vs Unknown" on Your week (production audit,
 * 2026-09-28). A placeholder is an absent name, so readers fall through to the next field — a team
 * name, then each surface's own honest fallback ("a manager", "opponent not named").
 *
 * Pure and client-safe.
 */
const PLACEHOLDERS = new Set(['unknown', 'unknown manager', 'unknown team', 'n/a', 'na', 'null', 'undefined', '-', '—'])

export function realManagerName(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim()
  if (!v) return null
  return PLACEHOLDERS.has(v.toLowerCase()) ? null : v
}
