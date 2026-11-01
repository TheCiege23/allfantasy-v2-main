export type PhotoSweepCursor = { priority: string | null; general: string | null }
export function readPhotoSweepCursor(value: unknown): PhotoSweepCursor {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : null
  return { priority: id(row.priority), general: id(row.general) }
}
/** Stable keyset paging wraps after reaching the end, so unresolved photos cannot starve later players. */
export async function readPhotoSweepPage<T>(
  cursor: string | null, limit: number,
  read: (range: { gt?: string; lte?: string }, take: number) => Promise<T[]>,
): Promise<T[]> {
  const first = await read(cursor ? { gt: cursor } : {}, limit)
  return cursor && first.length < limit
    ? [...first, ...await read({ lte: cursor }, limit - first.length)]
    : first
}
export function advancePhotoSweepCursor(previous: PhotoSweepCursor, priorityIds: string[], missingIds: string[], lastAttemptedId?: string): PhotoSweepCursor {
  const at = lastAttemptedId ? missingIds.indexOf(lastAttemptedId) : -1
  if (at < 0) return previous
  return {
    priority: at < priorityIds.length ? missingIds[at]! : priorityIds.at(-1) ?? previous.priority,
    general: at >= priorityIds.length ? missingIds[at]! : previous.general,
  }
}
