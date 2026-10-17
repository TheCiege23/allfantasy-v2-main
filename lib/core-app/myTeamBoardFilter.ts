/**
 * The cross-league board's filter chips — format, sport, platform.
 *
 * ⚠ APPLIED IN THE LOADER, NOT THE COMPONENT. `getMyTeamPulse` caps both columns at ten before they
 * cross to the client, so a client-side filter can only ever see the ten rows already on screen —
 * "Dynasty" on a 94-league account would have found the two dynasty leagues that happened to lock
 * soonest. The loader counts chips over EVERY readable row, then filters, then caps; the chips are
 * links (`?format=dynasty`), so a filtered board is a URL and needs no browser storage.
 *
 * ⚠ ONE CHIP AT A TIME, ON PURPOSE. Combining "NBA" with "Dynasty" can match nothing, and an empty
 * board here is not neutral: every empty branch below the rows says something about the WHOLE
 * account ("we could not read a single lineup"). A single chip drawn only from values that occur on
 * the rows always leaves at least one row, so none of those sentences can fire under a filter. A
 * param naming no chip on this board (a league left, a typo) is ignored, not obeyed into emptiness.
 *
 * ⚠ A DIMENSION WITH ONE VALUE GETS NO CHIPS. 513 of 560 production leagues are Sleeper NFL; a
 * "Sleeper" chip on such an account filters nothing and is noise. The format row is the one most
 * accounts will see (297 redraft · 212 dynasty on 2026-10-03).
 *
 * Client-safe: type imports only.
 */

import type { MyTeamRow } from './myTeamPulse'

export type BoardFilterDim = 'format' | 'sport' | 'platform'
export type BoardFilter = { dim: BoardFilterDim; value: string }
export type BoardFilterOption = BoardFilter & { label: string; count: number }

/** Also the precedence when a URL carries more than one: the first present wins. */
const DIMS: readonly BoardFilterDim[] = ['format', 'sport', 'platform']

function valueOf(row: MyTeamRow, dim: BoardFilterDim): string | undefined {
  if (dim === 'format') return row.format
  if (dim === 'sport') return row.sport
  return row.platform
}

function labelOf(row: MyTeamRow, dim: BoardFilterDim, value: string): string {
  if (dim === 'format') return row.formatLabel ?? value
  /* The row already prints the platform upper-cased beside the league name; the chip matches it. */
  return value.toUpperCase()
}

/** Every chip worth drawing, grouped by dimension, most leagues first within each. */
export function boardFilterOptions(rows: readonly MyTeamRow[]): BoardFilterOption[] {
  const out: BoardFilterOption[] = []
  for (const dim of DIMS) {
    const byValue = new Map<string, BoardFilterOption>()
    for (const row of rows) {
      const value = valueOf(row, dim)
      if (!value) continue
      const hit = byValue.get(value)
      if (hit) hit.count += 1
      else byValue.set(value, { dim, value, label: labelOf(row, dim, value), count: 1 })
    }
    if (byValue.size < 2) continue
    out.push(...[...byValue.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)))
  }
  return out
}

export function matchesBoardFilter(row: MyTeamRow, filter: BoardFilter | null): boolean {
  return filter == null || valueOf(row, filter.dim) === filter.value
}

/** The requested filter, only while it names a chip on this board. Case-insensitive on the value. */
export function availableFilter(filter: BoardFilter | null, options: readonly BoardFilterOption[]): BoardFilter | null {
  if (!filter) return null
  const want = filter.value.toLowerCase()
  const hit = options.find((o) => o.dim === filter.dim && o.value.toLowerCase() === want)
  return hit ? { dim: hit.dim, value: hit.value } : null
}

/** `?format=dynasty` / `?sport=NBA` / `?platform=espn` — the first dimension present wins. */
export function boardFilterFromParams(sp: Record<string, string | string[] | undefined> | null | undefined): BoardFilter | null {
  if (!sp) return null
  for (const dim of DIMS) {
    const raw = sp[dim]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    if (value) return { dim, value: value.slice(0, 40) }
  }
  return null
}

export function boardFilterHref(base: string, filter: BoardFilter | null): string {
  return filter ? `${base}?${filter.dim}=${encodeURIComponent(filter.value)}` : base
}
