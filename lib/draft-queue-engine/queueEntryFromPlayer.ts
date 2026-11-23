import type { QueueEntry } from '@/lib/live-draft-engine/types'

/**
 * The queue row for a player picked from the draft pool, WITH his id.
 *
 * 🛑 A QUEUED PLAYER WAS SAVED WITHOUT HIS ID, AND AUTOPICK THEN DRAFTED HIM WITHOUT ONE. The draft
 * room built the row from the name, position and team alone; queue-first autopick submits
 * `entry.playerId ?? null`; so every pick made from a manager's queue was stored with no id. A pick
 * with no id is given a made-up one when the draft finishes, no stat row is filed under it, and the
 * player sits on a roster and scores zero all season. Seen in a live NFL draft on 2026-11-19: of 120
 * picks, the two with no id were the two the manager had queued, made 12 and 17 seconds into his
 * clock. Every best-available pick had its id.
 *
 * The id is chosen the way a manual pick chooses it (`handleMakePick`): the pool row's own id, and a
 * namespaced one ("NFL:8150") only when nothing plainer is there.
 */
export function stablePoolPlayerId(player: {
  playerId?: string | null
  display?: { playerId?: string | null } | null
}): string | null {
  const display = String(player.display?.playerId ?? '').trim()
  const own = String(player.playerId ?? '').trim()
  if (display && !display.includes(':')) return display
  if (own && !own.includes(':')) return own
  return display || own || null
}

export function queueEntryFromPlayer(player: {
  name: string
  position: string
  team?: string | null
  playerId?: string | null
  display?: { playerId?: string | null } | null
}): QueueEntry {
  return {
    playerName: player.name,
    position: player.position,
    team: player.team ?? null,
    playerId: stablePoolPlayerId(player),
  }
}
