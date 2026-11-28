/**
 * Pure helpers that keep the draft room's player list from redoing whole-pool work
 * (components/app/draft-room/PlayerPanel.tsx, DraftRoomPageClient.tsx, 2026-11-28).
 *
 * Measured in production with the full NCAAB pool (5,022 players): the room spent 4.3 s in its own
 * React work on load, against 1.15 s for a 507-player NBA pool. Most of the gap was an O(n^2) search
 * re-check (`filteredDraft.some(...)` once per row) and a pool that was replaced on every live-sync
 * refetch even when the server returned the same cached copy.
 */

/** The key `filteredDraft.some(d => d.name === p.name && d.position === p.position)` compared on. */
export function draftRowIdentityKey(row: { name: string; position: string }): string {
  return `${row.name}\u0000${row.position}`
}

/** A Set of row identities, so the per-row check is O(1) instead of a scan of the whole list. */
export function draftRowIdentitySet(rows: ReadonlyArray<{ name: string; position: string }>): Set<string> {
  const out = new Set<string>()
  for (const row of rows) out.add(draftRowIdentityKey(row))
  return out
}

type PoolLike = {
  entries: unknown[]
  meta?: { cacheKey?: string; cachedAt?: string | null; source?: string } | null
} | null | undefined

/**
 * True when a refetched pool is the SAME cached copy the room already holds: same cache key, same
 * `cachedAt`, same entry count. Keeping the previous object then stops every derived list
 * (players, filters, counts, board headshots) from being rebuilt for identical data.
 *
 * Never "same" without a `cachedAt` and a `cacheKey` on both sides: a response that does not say which
 * copy it is must be applied, or a real change could be dropped.
 */
export function isSameCachedDraftPool(prev: PoolLike, next: PoolLike): boolean {
  if (!prev || !next) return false
  const a = prev.meta
  const b = next.meta
  if (!a?.cacheKey || !b?.cacheKey || !a.cachedAt || !b.cachedAt) return false
  return (
    a.cacheKey === b.cacheKey &&
    a.cachedAt === b.cachedAt &&
    prev.entries.length === next.entries.length
  )
}
