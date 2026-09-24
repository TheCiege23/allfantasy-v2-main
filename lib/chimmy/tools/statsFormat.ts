/**
 * Formatting helpers shared by the real-stats tools (`realStatsTools.ts` for football,
 * `dailySportStats.ts` for MLB / NBA / NHL). Pure functions, no I/O.
 */

/** The longest run of letters in a name — the ILIKE prefilter, same rule the projection reader uses. */
export function nameToken(raw: string): string {
  const parts = String(raw).split(/[^A-Za-z]+/).filter(Boolean)
  return parts.reduce((best, p) => (p.length > best.length ? p : best), '')
}

export function isoMinute(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : `${t.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** The newest of some timestamps. By time — `Array.sort()` on Dates compares their strings. */
export function latest(values: Array<Date | string | null | undefined>): Date | null {
  let best: number | null = null
  for (const v of values) {
    if (!v) continue
    const t = new Date(v).getTime()
    if (Number.isFinite(t) && (best == null || t > best)) best = t
  }
  return best == null ? null : new Date(best)
}

export function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}
