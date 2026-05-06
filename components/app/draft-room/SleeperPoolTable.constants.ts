/**
 * D.2 — SleeperPoolTable shared constants split out of SleeperPoolTable.tsx so they
 * can be imported by tests without dragging the JSX-heavy component through the
 * Vitest/oxc transform (which rejects some valid TSX patterns this repo uses).
 *
 * Anything in this file must stay framework-free (no React, no JSX) — that's
 * what keeps the test side fast + transform-safe.
 */

export const SLEEPER_POOL_TABLE_ROW_HEIGHT = 40
export const SLEEPER_POOL_TABLE_HEADER_HEIGHT = 32

export interface ColumnSpec {
  key: string
  label: string
  /** Width in px; sum should be roughly SLEEPER_POOL_TABLE_MIN_WIDTH. */
  width: number
  /** 'right' for numeric stat columns (Sleeper convention); 'left' for the player block. */
  align: 'left' | 'right'
  /** Tooltip / a11y title. */
  title?: string
}

/**
 * D.4 — Full descriptive labels for every column. Used for the native `title`
 * tooltip on header buttons AND for per-row cell tooltips
 * ("Bijan Robinson rushing yards"). `statLabel` is the human-friendly
 * descriptor we splice into row tooltips.
 */
export const SLEEPER_POOL_TABLE_COLUMNS: readonly (ColumnSpec & { statLabel?: string })[] = [
  { key: 'rk', label: 'RK', width: 44, align: 'right', title: 'Current rank by selected sort (defaults to ADP rank)' },
  { key: 'player', label: 'PLAYER', width: 240, align: 'left', title: 'Player — click to sort alphabetically' },
  { key: 'adp', label: 'ADP', width: 60, align: 'right', title: 'Average Draft Position', statLabel: 'ADP' },
  { key: 'aiAdp', label: 'AI ADP', width: 64, align: 'right', title: 'AllFantasy AI Draft Position', statLabel: 'AI ADP' },
  { key: 'bye', label: 'BYE', width: 44, align: 'right', title: 'NFL bye week', statLabel: 'bye week' },
  { key: 'pts', label: 'PTS', width: 60, align: 'right', title: 'Total fantasy points (season)', statLabel: 'fantasy points' },
  { key: 'avg', label: 'AVG', width: 56, align: 'right', title: 'Fantasy points per game', statLabel: 'fantasy points per game' },
  { key: 'ru_att', label: 'RU ATT', width: 60, align: 'right', title: 'Rushing attempts', statLabel: 'rushing attempts' },
  { key: 'ru_yds', label: 'RU YDS', width: 64, align: 'right', title: 'Rushing yards', statLabel: 'rushing yards' },
  { key: 'ru_td', label: 'RU TD', width: 56, align: 'right', title: 'Rushing touchdowns', statLabel: 'rushing touchdowns' },
  { key: 'rec', label: 'REC', width: 52, align: 'right', title: 'Receptions', statLabel: 'receptions' },
  { key: 'rec_yds', label: 'REC YDS', width: 68, align: 'right', title: 'Receiving yards', statLabel: 'receiving yards' },
  { key: 'rec_td', label: 'REC TD', width: 60, align: 'right', title: 'Receiving touchdowns', statLabel: 'receiving touchdowns' },
  { key: 'pa_att', label: 'PA ATT', width: 60, align: 'right', title: 'Passing attempts', statLabel: 'passing attempts' },
  { key: 'pa_yds', label: 'PA YDS', width: 68, align: 'right', title: 'Passing yards', statLabel: 'passing yards' },
  { key: 'pa_td', label: 'PA TD', width: 56, align: 'right', title: 'Passing touchdowns', statLabel: 'passing touchdowns' },
  { key: 'pa_int', label: 'PA INT', width: 60, align: 'right', title: 'Passing interceptions', statLabel: 'passing interceptions' },
  { key: 'actions', label: '', width: 124, align: 'right' },
] as const

/**
 * D.4 — formats a per-cell tooltip string. Examples:
 *   cellTooltip('Bijan Robinson', 'rushing yards', 1340) → "Bijan Robinson — rushing yards: 1,340"
 *   cellTooltip('Joe Burrow', 'receiving yards', null) → "Joe Burrow — no receiving yards data available"
 */
export function cellTooltip(
  playerName: string,
  statLabel: string,
  rawValue: number | null | undefined,
): string {
  const name = playerName.trim() || 'Player'
  if (rawValue == null || !Number.isFinite(Number(rawValue))) {
    return `${name} — no ${statLabel} data available`
  }
  const n = Number(rawValue)
  const formatted = Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
  return `${name} — ${statLabel}: ${formatted}`
}

/** Sum of all column widths — table sets this as `min-width` so the parent's
 * `overflow-x-auto` handles narrow viewports without squishing columns. */
export const SLEEPER_POOL_TABLE_MIN_WIDTH = SLEEPER_POOL_TABLE_COLUMNS.reduce(
  (sum, c) => sum + c.width,
  0,
)
