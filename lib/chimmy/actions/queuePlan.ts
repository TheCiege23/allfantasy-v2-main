/**
 * Pure helpers for a Chimmy draft-queue card (`./queueAction.ts`): the queue fingerprint the confirm
 * re-checks, the add/remove/move edit, and name matching. No server imports, so tests need no database.
 */
import type { QueueEntry } from '@/lib/live-draft-engine/types'

/** "Ja'Marr Chase" → "jamarrchase". The same key for a request, a queue row and a pool row. */
export function queueNameKey(name: string): string {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
}

/**
 * The queue as the user was shown it, by player and order. The confirm refuses if it differs, so a
 * card can never apply to a queue the user did not see (the lineup card's `baseFingerprint` rule).
 */
export function queueFingerprint(entries: ReadonlyArray<{ playerName: string }>): string {
  const joined = entries.map((e) => queueNameKey(e.playerName)).join('|')
  let h = 5381
  for (let i = 0; i < joined.length; i += 1) h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0
  return `${entries.length}:${h.toString(16)}`
}

export type QueuePlayer = { playerName: string; position: string; team: string | null; playerId: string | null }

/**
 * The edit: drop `removeKeys`, then put `add` at the top or the bottom. A player being added who is
 * already queued is MOVED (taken out of their old spot first), so "move Waddle to the top" is an add.
 */
export function applyQueueOps(
  current: readonly QueueEntry[],
  ops: { add: readonly QueuePlayer[]; addAt: 'top' | 'bottom'; removeKeys: readonly string[] },
): QueueEntry[] {
  const drop = new Set([...ops.removeKeys, ...ops.add.map((p) => queueNameKey(p.playerName))])
  const rest = current.filter((e) => !drop.has(queueNameKey(e.playerName)))
  const added: QueueEntry[] = ops.add.map((p) => ({ playerName: p.playerName, position: p.position, team: p.team, playerId: p.playerId }))
  return ops.addAt === 'top' ? [...added, ...rest] : [...rest, ...added]
}

export type NameMatch<T> = { ok: true; item: T } | { ok: false; reason: 'none' | 'ambiguous'; candidates: T[] }

/**
 * A requested name against a list: an exact key match first, else a UNIQUE partial one ("Waddle" →
 * Jaylen Waddle). Two exact matches, or several partial ones, are ambiguous — never a guess.
 */
export function matchByName<T>(requested: string, items: readonly T[], nameOf: (t: T) => string): NameMatch<T> {
  const key = queueNameKey(requested)
  if (!key) return { ok: false, reason: 'none', candidates: [] }
  const exact = items.filter((t) => queueNameKey(nameOf(t)) === key)
  if (exact.length === 1) return { ok: true, item: exact[0]! }
  if (exact.length > 1) return { ok: false, reason: 'ambiguous', candidates: exact.slice(0, 4) }
  if (key.length < 4) return { ok: false, reason: 'none', candidates: [] }
  const partial = items.filter((t) => queueNameKey(nameOf(t)).includes(key))
  if (partial.length === 1) return { ok: true, item: partial[0]! }
  return { ok: false, reason: partial.length > 1 ? 'ambiguous' : 'none', candidates: partial.slice(0, 4) }
}
