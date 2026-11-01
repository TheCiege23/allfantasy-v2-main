/** FFC's sample end is the observation date. Fetch time cannot make an old draft sample current. */
export function ffcObservationDate(meta: unknown): Date | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const end = (meta as Record<string, unknown>).endDate
  if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null
  const date = new Date(end + 'T00:00:00.000Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === end ? date : null
}
export function ffcObservationIsFresh(meta: unknown, now = new Date()): boolean {
  const date = ffcObservationDate(meta)
  if (!date) return false
  const age = now.getTime() - date.getTime()
  return age >= 0 && age <= 7 * 86400000
}
