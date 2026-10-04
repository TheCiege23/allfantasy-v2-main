type Metadata = { name: string; position: string | null; team: string | null }
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
// These are occupied roster slots, never an athlete's directory position.
const rosterSlots = new Set(['UNK','N/A','UNKNOWN','BN','BENCH','IR','IL','IL+','RESERVE','TAXI','RWT','SFX','FLEX','SUPERFLEX','SUPER_FLEX','UTIL','UTILITY'])
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

/** Preserve provider metadata under its source ID; never turn it into an identity crosswalk. */
export function snapshotImportedPlayerMetadata(ids: readonly string[], playerMap: unknown): Record<string, Metadata> {
  const map = object(playerMap), out: Record<string, Metadata> = {}
  if (!map) return out
  for (const id of ids) {
    const row = object(map[id]), name = text(row?.name)
    if (!name || name === id || /^unknown player/i.test(name)) continue
    const position = text(row?.position).toUpperCase()
    out[id] = { name, position: !position || rosterSlots.has(position) ? null : position, team: text(row?.team) || null }
  }
  return out
}

export function readImportedPlayerMetadata(blob: unknown, provider: string, playerId: string): Metadata | null {
  const data = object(blob)
  if (text(data?.source_provider).toLowerCase() !== provider.toLowerCase()) return null
  const ids = Array.isArray(data?.players) ? data.players.filter((id): id is string => typeof id === 'string') : []
  if (!ids.includes(playerId)) return null
  return snapshotImportedPlayerMetadata([playerId], data?.player_metadata)[playerId] ?? null
}

/** The saved Fantrax snapshot contains source IDs and directory positions, not AF identities. */
export function fantraxSnapshotPlayerMap(snapshot: unknown): Record<string, Metadata> {
  const out: Record<string, Metadata> = {}
  if (!Array.isArray(snapshot)) return out
  const claims = new Map<string, Metadata[]>()
  for (const value of snapshot) {
    const row = object(value), id = text(row?.fantraxId)
    if (!id) continue
    const mapped = snapshotImportedPlayerMetadata([id], { [id]: { name: row?.name, position: row?.primaryPosition, team: row?.team } })[id]
    if (mapped) claims.set(id, [...(claims.get(id) ?? []), mapped])
  }
  for (const [id, rows] of claims) {
    const variants = new Set(rows.map(row => JSON.stringify(row)))
    if (variants.size === 1) out[id] = rows[0]!
  }
  return out
}
