/**
 * Player keys for `rookie_eligibility_records.playerKey` — always NAMESPACED, never a bare id.
 *
 * 🛑 A BARE ID NAMES A STRANGER. Rolling Insights, CFBD, API-Football and Sleeper all write bare
 * numbers that collide for different people (lib/player-identity/externalIdNamespace.ts: Sleeper
 * 9228 is Bryce Young, RI 9228 is an offensive tackle). A verdict keyed `9228` would be read back
 * for whichever of them asked. So a key states its id space:
 *
 *   sports_player:<SportsPlayer.id>         our own row id — what the draft pool holds
 *   vendor:<source>:<sourcePlayerId>        a prospect vendor's id, scoped by that vendor
 *
 * `parsePlayerKey` returns null for anything else, and the reader and writer both drop nulls rather
 * than guessing which space a bare token was meant to be in.
 */

export type PlayerKeyRef =
  | { kind: 'sports_player'; id: string }
  | { kind: 'vendor'; source: string; sourcePlayerId: string }

/** Vendor / rule-set slugs: lowercase, start with a letter, ≤ 32 chars (the column width). */
const SOURCE_SLUG = /^[a-z][a-z0-9_]{1,31}$/

const MAX_KEY_LENGTH = 160

export function isValidSourceSlug(source: string | null | undefined): source is string {
  return typeof source === 'string' && SOURCE_SLUG.test(source)
}

function cleanId(raw: string | null | undefined): string {
  return String(raw ?? '').trim()
}

export function sportsPlayerKey(sportsPlayerId: string): string | null {
  const id = cleanId(sportsPlayerId)
  if (!id || id.includes(':')) return null
  const key = `sports_player:${id}`
  return key.length <= MAX_KEY_LENGTH ? key : null
}

export function vendorPlayerKey(source: string, sourcePlayerId: string): string | null {
  const id = cleanId(sourcePlayerId)
  if (!isValidSourceSlug(source) || !id) return null
  const key = `vendor:${source}:${id}`
  return key.length <= MAX_KEY_LENGTH ? key : null
}

export function playerKeyFromRef(ref: PlayerKeyRef): string | null {
  return ref.kind === 'sports_player' ? sportsPlayerKey(ref.id) : vendorPlayerKey(ref.source, ref.sourcePlayerId)
}

/** The ref a key names, or null when it is bare, malformed, or in an id space we do not know. */
export function parsePlayerKey(key: string | null | undefined): PlayerKeyRef | null {
  const k = cleanId(key)
  if (!k || k.length > MAX_KEY_LENGTH) return null
  if (k.startsWith('sports_player:')) {
    const id = k.slice('sports_player:'.length)
    return id && !id.includes(':') ? { kind: 'sports_player', id } : null
  }
  if (k.startsWith('vendor:')) {
    const rest = k.slice('vendor:'.length)
    const sep = rest.indexOf(':')
    if (sep < 0) return null
    const source = rest.slice(0, sep)
    const sourcePlayerId = rest.slice(sep + 1)
    return isValidSourceSlug(source) && sourcePlayerId ? { kind: 'vendor', source, sourcePlayerId } : null
  }
  return null
}
