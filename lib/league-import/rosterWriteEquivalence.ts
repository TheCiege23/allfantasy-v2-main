/**
 * Does an imported roster write change anything?
 *
 * The league sync re-applies every roster on every run — every five minutes per in-season league
 * from the active lane — and almost every run finds the roster exactly as it left it. Rewriting the
 * whole `playerData` document each time produced ~228k full-row roster updates a day for ~6,700
 * rosters (measured 2026-10-23), each one a fresh copy of a ~2.7 KB JSON value and its TOAST.
 *
 * ⚠ TWO KEYS ARE EXCLUDED FROM THE COMPARISON, AND ONLY TWO. `imported_at` and `import_batch_id`
 * describe the RUN that produced the document, not the roster, so they differ on every sync by
 * construction. Comparing them would make every roster look changed and this whole check a no-op.
 * Nothing reads either back out of `Roster.playerData` as a freshness signal — freshness lives on
 * `Roster.updatedAt`, which the caller still advances for an unchanged roster.
 *
 * Everything else is compared, including keys this writer does not own: if another writer has
 * added a key since, the incoming document (which lacks it) differs and is written, which is what
 * the unconditional write always did.
 */
const RUN_SCOPED_PLAYER_DATA_KEYS = new Set(['imported_at', 'import_batch_id'])

/**
 * JSON with object keys sorted at every depth.
 *
 * ⚠ KEY ORDER IS NOT DATA, AND JSONB DOES NOT KEEP IT. Postgres stores object keys in its own order
 * (shorter keys first), so a document read back never serializes like the object that was written.
 * Array order IS data (players, starters) and is kept. `undefined` is dropped, as JSON.stringify —
 * and therefore Prisma — drops it on write.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

function withoutRunScopedKeys(playerData: unknown): unknown {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return playerData
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(playerData as Record<string, unknown>)) {
    if (!RUN_SCOPED_PLAYER_DATA_KEYS.has(key)) out[key] = v
  }
  return out
}

/** True when the two `playerData` documents describe the same roster. */
export function importedPlayerDataEquivalent(stored: unknown, incoming: unknown): boolean {
  return stableJson(withoutRunScopedKeys(stored)) === stableJson(withoutRunScopedKeys(incoming))
}

export type StoredImportedRoster = {
  platformUserId: string
  playerData: unknown
  faabRemaining: number | null
  waiverPriority: number | null
}

export type IncomingImportedRoster = {
  platformUserId: string
  playerData: unknown
  faabRemaining: number | null
  waiverPriority: number | null
}

/** True when writing `incoming` over `stored` would change no column the import owns. */
export function importedRosterUnchanged(stored: StoredImportedRoster, incoming: IncomingImportedRoster): boolean {
  return (
    stored.platformUserId === incoming.platformUserId &&
    (stored.faabRemaining ?? null) === (incoming.faabRemaining ?? null) &&
    (stored.waiverPriority ?? null) === (incoming.waiverPriority ?? null) &&
    importedPlayerDataEquivalent(stored.playerData, incoming.playerData)
  )
}
