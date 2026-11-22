/**
 * A short fingerprint of WHO is on a roster and WHERE they sit — the version a lineup save is built on.
 *
 * The roster screen sends back the version it loaded (`expectedLineupVersion`) and the save engine refuses
 * when the stored roster no longer has it. That matters most for an edit made offline and sent minutes or
 * hours later: a save carries the whole lineup, so one built on a roster that has since changed — a waiver
 * add, a trade, the manager on another device — would silently undo that change.
 *
 * Player ids and positions only. Names, projections, game times and `lineup_updated_at` are left out on
 * purpose: they are rewritten by syncs that move nobody, and counting them would refuse a good save.
 */
const SECTION_KEYS = ['starters', 'bench', 'ir', 'taxi', 'devy', 'campus'] as const
const LEGACY_KEYS = ['players', 'starters', 'reserve', 'taxi', 'devy'] as const

function idOf(raw: unknown): string | null {
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw).trim() || null
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const id = o.id ?? o.player_id
    if (typeof id === 'string' || typeof id === 'number') return String(id).trim() || null
  }
  return null
}

function entry(raw: unknown): string | null {
  const id = idOf(raw)
  if (!id) return null
  const slot = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).slotIndex : undefined
  return typeof slot === 'number' && Number.isInteger(slot) ? `${id}@${slot}` : id
}

function list(raw: unknown, read: (v: unknown) => string | null): string[] {
  return Array.isArray(raw) ? raw.map(read).filter((v): v is string => Boolean(v)) : []
}

/** FNV-1a, 32 bit. A version tag, not a security boundary — the server re-reads the roster either way. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function lineupVersionOf(playerData: unknown): string {
  const o = playerData && typeof playerData === 'object' && !Array.isArray(playerData) ? (playerData as Record<string, unknown>) : {}
  const sections = o.lineup_sections && typeof o.lineup_sections === 'object' ? (o.lineup_sections as Record<string, unknown>) : {}
  const shape = {
    s: SECTION_KEYS.map((k) => list(sections[k], entry)),
    // `players` is a set; its order carries no meaning.
    l: LEGACY_KEYS.map((k) => (k === 'players' ? list(o[k], idOf).sort() : list(o[k], idOf))),
  }
  return fnv1a(JSON.stringify(shape))
}
