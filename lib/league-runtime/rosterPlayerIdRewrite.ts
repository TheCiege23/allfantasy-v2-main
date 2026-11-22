/**
 * Rewrite player ids inside a `Roster.playerData` blob, and work out which ids need rewriting.
 *
 * 🛑 A REPAIRED SCORING ROW WITH AN UNREPAIRED ROSTER IS STILL BROKEN. `scripts/repair-roster-provider-ids.ts`
 * corrected `RedraftRosterPlayer.playerId` (Rolling Insights numbers and `name:` placeholders the old
 * draft pool handed out) but left `Roster.playerData` — the lineup, the trade picker and every native
 * move path — on the old id. Measured on production 2026-10-19, native NFL league 4a1853d7: 3 of 12
 * rosters disagreed (`8563` vs Marvin Harrison Jr.'s Sleeper `11628`, `6572` vs `8138`,
 * `name:Brian Thomas Jr.:WR:JAX` vs `11631`). Benching such a player changes nothing that scores
 * (`redraftSlotSync` matches by id), and dropping or trading him leaves his scoring row live.
 *
 * Pure and dependency-free, so the repair script and its tests share one rule.
 */

type Json = unknown

function asRecord(v: Json): Record<string, Json> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Json>) : null
}

/** The id an entry names: a bare string, or `{ id | player_id | playerId }`. */
function entryId(entry: Json): string {
  if (typeof entry === 'string') return entry
  const r = asRecord(entry)
  return String(r?.id ?? r?.player_id ?? r?.playerId ?? '')
}

function rewriteEntry(entry: Json, mapping: ReadonlyMap<string, string>): Json {
  if (typeof entry === 'string') return mapping.get(entry) ?? entry
  const r = asRecord(entry)
  if (!r) return entry
  let out: Record<string, Json> | null = null
  for (const key of ['id', 'player_id', 'playerId']) {
    const v = r[key]
    if (typeof v === 'string' && mapping.has(v)) {
      out = out ?? { ...r }
      out[key] = mapping.get(v)!
    }
  }
  return out ?? entry
}

const LIST_KEYS = ['players', 'starters', 'reserve', 'taxi', 'devy', 'draftPicks'] as const

/** Every list and lineup section, with ids remapped. Returns the input unchanged when nothing maps. */
export function rewriteRosterPlayerIds(playerData: Json, mapping: ReadonlyMap<string, string>): Json {
  const data = asRecord(playerData)
  if (!data || mapping.size === 0) return playerData
  const out: Record<string, Json> = { ...data }
  for (const key of LIST_KEYS) {
    if (Array.isArray(data[key])) out[key] = (data[key] as Json[]).map((e) => rewriteEntry(e, mapping))
  }
  for (const sectionsKey of ['lineup_sections', 'lineupSections'] as const) {
    const sections = asRecord(data[sectionsKey])
    if (!sections) continue
    const next: Record<string, Json> = {}
    for (const [name, list] of Object.entries(sections)) {
      next[name] = Array.isArray(list) ? list.map((e) => rewriteEntry(e, mapping)) : list
    }
    out[sectionsKey] = next
  }
  return out
}

/** Ids on any roster list or lineup section. */
export function rosterPlayerIds(playerData: Json): Set<string> {
  const data = asRecord(playerData)
  const ids = new Set<string>()
  if (!data) return ids
  for (const key of ['players', 'starters', 'reserve', 'taxi', 'devy'] as const) {
    if (Array.isArray(data[key])) for (const e of data[key] as Json[]) if (entryId(e)) ids.add(entryId(e))
  }
  for (const sectionsKey of ['lineup_sections', 'lineupSections'] as const) {
    for (const list of Object.values(asRecord(data[sectionsKey]) ?? {})) {
      if (Array.isArray(list)) for (const e of list) if (entryId(e)) ids.add(entryId(e))
    }
  }
  return ids
}

function normName(name: Json): string {
  return String(name ?? '').trim().toLowerCase()
}

/**
 * Old id → the scoring row's id, for a roster whose scoring rows were repaired but whose blob was not.
 *
 * Matched only WITHIN one roster and only by an exact, unique player name: the blob's `draftPicks`
 * entry carries the name the old id was drafted under, and a live scoring row on the same roster with
 * that same name — and an id the blob does not carry — is the same man. Anything ambiguous (two picks
 * or two rows sharing a name) is left alone and reported by the caller; a wrong rewrite is worse than
 * the mismatch.
 */
export function proposeRosterIdPropagation(
  playerData: Json,
  liveRows: ReadonlyArray<{ playerId: string; playerName: string }>,
): Map<string, string> {
  const data = asRecord(playerData)
  const picks = Array.isArray(data?.draftPicks) ? (data!.draftPicks as Json[]) : []
  const onBlob = rosterPlayerIds(playerData)
  const liveIds = new Set(liveRows.map((r) => r.playerId))

  const orphanRowsByName = new Map<string, string[]>()
  for (const row of liveRows) {
    if (onBlob.has(row.playerId)) continue
    const key = normName(row.playerName)
    orphanRowsByName.set(key, [...(orphanRowsByName.get(key) ?? []), row.playerId])
  }
  const pickIdsByName = new Map<string, Set<string>>()
  for (const pick of picks) {
    const r = asRecord(pick)
    const id = entryId(pick)
    if (!r || !id) continue
    const key = normName(r.playerName ?? r.name)
    pickIdsByName.set(key, (pickIdsByName.get(key) ?? new Set()).add(id))
  }

  const mapping = new Map<string, string>()
  for (const [name, rowIds] of orphanRowsByName) {
    const pickIds = pickIdsByName.get(name)
    if (rowIds.length !== 1 || !pickIds || pickIds.size !== 1) continue
    const from = [...pickIds][0]!
    // Only an id the blob still names and no scoring row carries — i.e. the stale one.
    if (onBlob.has(from) && !liveIds.has(from)) mapping.set(from, rowIds[0]!)
  }
  return mapping
}
