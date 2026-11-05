/** A college slate cannot establish an empty week beyond its last published date. */
export function nbaCampusScheduleCoversWindow(meta: unknown, window: { end: Date } | null): boolean {
  if (!window || !meta || typeof meta !== 'object' || Array.isArray(meta)) return false
  const value = meta as Record<string, unknown>
  const first = typeof value.firstDay === 'string' ? Date.parse(`${value.firstDay}T00:00:00Z`) : NaN
  const last = typeof value.lastDay === 'string' ? Date.parse(`${value.lastDay}T00:00:00Z`) : NaN
  return Number.isFinite(first) && Number.isFinite(last) && first <= last && window.end.getTime() <= last + 86400000
}
