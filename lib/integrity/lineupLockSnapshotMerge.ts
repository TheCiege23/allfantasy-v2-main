/**
 * How one hourly read becomes the week's snapshot — pure, so the freezing rule is tested rather than
 * trusted.
 *
 *   - A player whose game has NOT started takes this hour's projection, status and bye.
 *   - A player whose game HAS started keeps the entry it had, and is stamped `frozenAt` the first hour
 *     the player is seen locked. That entry never changes again: it is what the manager saw at kickoff.
 *   - A player first seen already locked (the writer missed that kickoff hour, or the player was added late) is
 *     captured once from this read and frozen at once. Better a slightly late reading than none.
 *   - A player who left the roster keeps the entry: the week's saved lineup may still name them.
 */

import type { SnapshotPlayer } from './lineupIntegrityScore'

export type SnapshotPlayerMap = Record<string, SnapshotPlayer>

export function mergeSnapshotPlayers(input: {
  prior: SnapshotPlayerMap | null
  current: SnapshotPlayerMap
  lockedIds: ReadonlySet<string>
  nowIso: string
}): { players: SnapshotPlayerMap; changed: boolean } {
  const prior = input.prior ?? {}
  const players: SnapshotPlayerMap = { ...prior }
  let changed = input.prior == null

  for (const [id, now] of Object.entries(input.current)) {
    const before = prior[id]
    if (before?.frozenAt) continue // frozen at kickoff; nothing after that counts
    const locked = input.lockedIds.has(id)
    const entry: SnapshotPlayer = locked
      ? { ...(before ?? now), frozenAt: input.nowIso }
      : { ...now, frozenAt: null }
    if (!before || !samePlayer(before, entry)) {
      players[id] = entry
      changed = true
    }
  }
  return { players, changed }
}

function samePlayer(a: SnapshotPlayer, b: SnapshotPlayer): boolean {
  return (
    (a.proj ?? null) === (b.proj ?? null) &&
    (a.status ?? null) === (b.status ?? null) &&
    (a.bye ?? null) === (b.bye ?? null) &&
    (a.position ?? null) === (b.position ?? null) &&
    (a.name ?? null) === (b.name ?? null) &&
    (a.team ?? null) === (b.team ?? null) &&
    (a.frozenAt ?? null) === (b.frozenAt ?? null)
  )
}
