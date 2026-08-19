import type { ActivityFeedItem } from "@/lib/activity/types"

/**
 * Merge the per-source activity arrays into the single feed the UI consumes: flatten, de-dupe by
 * id (defensive — a source should never emit dupes, but two sources must never collide either),
 * sort newest-first by timestamp, and cap at `limit`. Pure + synchronous so it is trivially
 * unit-testable and carries no fabrication of its own — it only orders real items.
 */
export function mergeActivityItems(sources: ActivityFeedItem[][], limit: number): ActivityFeedItem[] {
  const seen = new Set<string>()
  const merged: ActivityFeedItem[] = []
  for (const source of sources) {
    for (const item of source) {
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
  }
  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const capped = Number.isFinite(limit) && limit > 0 ? merged.slice(0, limit) : merged
  return capped
}
