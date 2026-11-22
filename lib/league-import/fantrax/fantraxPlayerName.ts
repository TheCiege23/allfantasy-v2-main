import type { FantraxPlayerRef } from './fantraxApi'

/**
 * Fantrax's player directory (`getPlayerIds`) names players "Last, First" — captured as
 * `"Walter, JaKobe"` in tests/fixtures/fantrax/nba-player-ids-public.json. Everything else in this
 * repo, and every screen a manager reads, writes "First Last".
 *
 * Only a name with exactly one comma and text on both sides is flipped, so a suffix keeps its place
 * ("Smith Jr., Odell" → "Odell Smith Jr."), and a name that is already "First Last" comes back
 * unchanged — running this twice is the same as running it once.
 */
export function fantraxDisplayName(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  const parts = trimmed.split(',').map((part) => part.trim())
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : trimmed
}

/** The same directory with every player's name in "First Last" order. Ids and every other field are untouched. */
export function withFantraxDisplayNames<T extends Record<string, FantraxPlayerRef>>(directory: T): T {
  const out: Record<string, FantraxPlayerRef> = {}
  for (const [id, ref] of Object.entries(directory)) {
    out[id] = ref && typeof ref.name === 'string' ? { ...ref, name: fantraxDisplayName(ref.name) } : ref
  }
  return out as T
}
