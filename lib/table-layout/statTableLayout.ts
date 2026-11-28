/**
 * Saved column order, hidden columns and table density for the stat tables (2026-11-28).
 *
 * Yahoo's late-2026 redesign drew "each column is too large, waste of space", columns moved where
 * people did not want them (time on ice to the far right), and no way to put them back. Here a
 * manager can choose the order and which columns show, per table, and switch every stat table to a
 * compact density — saved to his account (statTableLayoutStore.ts), so it follows him across devices.
 *
 * Pure and client-safe. A layout is ADVISORY: it is applied over the table's own column list, so
 *   - a column the table no longer has is dropped from the saved order silently;
 *   - a column the table gained since the save appears in its default place, never lost;
 *   - at least one column always shows, whatever was saved.
 */

export type TableDensity = 'comfortable' | 'compact'

export type TableLayout = {
  /**
   * Column keys in the chosen order. The menu always saves the FULL order; a key missing from it is a
   * column the table gained since, and goes next to its default neighbour (see `applyLayout`).
   */
  order: string[]
  /** Column keys the manager hid. */
  hidden: string[]
}

export type StatTableLayouts = {
  density: TableDensity
  tables: Record<string, TableLayout>
}

export const EMPTY_LAYOUTS: StatTableLayouts = { density: 'comfortable', tables: {} }

/** Bounds on what is stored: table ids look like `gamelog:NHL:skaters`; a table has tens of columns. */
const TABLE_ID = /^[a-z][a-z0-9_-]{0,31}(:[A-Za-z0-9_-]{1,32}){0,3}$/
const COLUMN_KEY = /^[A-Za-z0-9_+%-]{1,32}$/
const MAX_COLUMNS = 40
const MAX_TABLES = 60

export function isTableId(id: unknown): id is string {
  return typeof id === 'string' && TABLE_ID.test(id)
}

function keys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const k of raw) if (typeof k === 'string' && COLUMN_KEY.test(k) && !out.includes(k)) out.push(k)
  return out.slice(0, MAX_COLUMNS)
}

export function sanitizeLayout(raw: unknown): TableLayout {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return { order: keys(o.order), hidden: keys(o.hidden) }
}

export function sanitizeDensity(raw: unknown): TableDensity {
  return raw === 'compact' ? 'compact' : 'comfortable'
}

/** Whatever is stored (or nothing), as a valid value. Unknown shapes read as the defaults. */
export function readLayouts(rawTables: unknown, rawDensity: unknown): StatTableLayouts {
  const tables: Record<string, TableLayout> = {}
  if (rawTables && typeof rawTables === 'object' && !Array.isArray(rawTables)) {
    for (const [id, v] of Object.entries(rawTables as Record<string, unknown>).slice(0, MAX_TABLES)) {
      if (isTableId(id)) tables[id] = sanitizeLayout(v)
    }
  }
  return { density: sanitizeDensity(rawDensity), tables }
}

/**
 * The columns to draw, in order. `defaults` is the table's own list (its default order); the layout
 * only reorders and hides within it.
 */
export function applyLayout<C extends { key: string }>(defaults: readonly C[], layout: TableLayout | null | undefined): C[] {
  if (!layout || (layout.order.length === 0 && layout.hidden.length === 0)) return [...defaults]
  const byKey = new Map(defaults.map((c) => [c.key, c]))
  const placed: C[] = []
  for (const k of layout.order) {
    const c = byKey.get(k)
    if (c && !placed.includes(c)) placed.push(c)
  }
  // Columns the saved order does not mention keep their default slot relative to their neighbours.
  for (const c of defaults) {
    if (placed.includes(c)) continue
    const i = defaults.indexOf(c)
    const before = defaults.slice(0, i).reverse().find((d) => placed.includes(d))
    placed.splice(before ? placed.indexOf(before) + 1 : 0, 0, c)
  }
  const hidden = new Set(layout.hidden)
  const shown = placed.filter((c) => !hidden.has(c.key))
  return shown.length > 0 ? shown : placed.slice(0, 1)
}

/** Move a column one step left (-1) or right (+1) within the full order, returning a new layout. */
export function moveColumn(defaults: readonly { key: string }[], layout: TableLayout, key: string, step: -1 | 1): TableLayout {
  const order = applyLayout(defaults, { order: layout.order, hidden: [] }).map((c) => c.key)
  const i = order.indexOf(key)
  const j = i + step
  if (i < 0 || j < 0 || j >= order.length) return layout
  ;[order[i], order[j]] = [order[j], order[i]]
  return { order, hidden: layout.hidden }
}

export function toggleColumn(layout: TableLayout, key: string): TableLayout {
  const hidden = layout.hidden.includes(key) ? layout.hidden.filter((k) => k !== key) : [...layout.hidden, key]
  return { order: layout.order, hidden }
}

export function isDefaultLayout(layout: TableLayout | null | undefined): boolean {
  return !layout || (layout.order.length === 0 && layout.hidden.length === 0)
}
