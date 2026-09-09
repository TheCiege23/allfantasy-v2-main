/**
 * Roster playerData helpers (multi-sport). playerData may be string[] or { players: string[] }.
 */

export function getRosterPlayerIds(playerData: unknown): string[] {
  if (Array.isArray(playerData)) {
    return (playerData as unknown[]).map((p) => (typeof p === "string" ? p : (p as any)?.id ?? (p as any)?.player_id ?? String(p))).filter(Boolean)
  }
  const players = (playerData as any)?.players
  return Array.isArray(players) ? players.map((p: any) => typeof p === "string" ? p : p?.id ?? p?.player_id ?? String(p)).filter(Boolean) : []
}

export function rosterContainsPlayer(playerData: unknown, playerId: string): boolean {
  return getRosterPlayerIds(playerData).includes(playerId)
}

type LineupSectionRow = string | { id?: unknown; player_id?: unknown; [key: string]: unknown }

function sectionRowId(row: LineupSectionRow): string {
  if (typeof row === 'string') return row
  return String(row?.id ?? row?.player_id ?? '')
}

/**
 * Adds/removes a player from every `lineup_sections` array (starters/bench/ir/taxi/devy) so the
 * nested shape `getNormalizedLineupSections` reads (Roster tab bench view, roster-legality gate)
 * stays in sync with the flat `players`/`starters` arrays this function also updates. Free-agent
 * adds land on the bench; drops are removed from whichever section they were in. Rosters with no
 * `lineup_sections` block yet are left alone (unrelated pre-draft/legacy state).
 */
function syncLineupSections(
  playerData: Record<string, unknown>,
  op: { addPlayerId?: string; removePlayerId?: string },
): Record<string, unknown> {
  const sections = playerData.lineup_sections
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return playerData
  const src = sections as Record<string, unknown>
  const keys = ['starters', 'bench', 'ir', 'taxi', 'devy'] as const
  const next: Record<string, unknown> = { ...src }
  for (const key of keys) {
    const rows = Array.isArray(src[key]) ? (src[key] as LineupSectionRow[]) : []
    next[key] = op.removePlayerId ? rows.filter((row) => sectionRowId(row) !== op.removePlayerId) : rows
  }
  if (op.addPlayerId) {
    const bench = Array.isArray(next.bench) ? (next.bench as LineupSectionRow[]) : []
    next.bench = [...bench, op.addPlayerId]
  }
  return { ...playerData, lineup_sections: next }
}

export function addPlayerToRosterData(playerData: unknown, playerId: string): unknown {
  const ids = getRosterPlayerIds(playerData)
  if (ids.includes(playerId)) return playerData
  if (Array.isArray(playerData)) return [...(playerData as string[]), playerId]
  const next = { ...(playerData as object), players: [...ids, playerId] }
  return syncLineupSections(next, { addPlayerId: playerId })
}

export function removePlayerFromRosterData(playerData: unknown, playerId: string): unknown {
  const ids = getRosterPlayerIds(playerData).filter((id) => id !== playerId)
  if (Array.isArray(playerData)) return ids
  const next = { ...(playerData as object), players: ids }
  return syncLineupSections(next, { removePlayerId: playerId })
}

export function getRosterSize(playerData: unknown): number {
  return getRosterPlayerIds(playerData).length
}

/**
 * Which section of the roster each player sits in, keyed by player id.
 *
 * 🛑 THE SLOT IS A FACT ABOUT THE ROSTER AND MUST NOT BE GUESSED. The waiver scorer reads
 * `slot === 'starter'` to find the worst starter a candidate would replace, and reads
 * `slot === 'bench'` to pick a drop. Defaulting everyone to bench would make every candidate look
 * like a free upgrade and would nominate a starter as the drop.
 *
 * ⚠ `players` IS THE SUPERSET AND CARRIES NO SLOT. Sleeper (and the importers that follow it)
 * writes a flat `players` array plus `starters` / `taxi` / `reserve` arrays naming the subsets, so
 * a player's slot is the array they ALSO appear in, and bench is the remainder. Anyone not named by
 * a subset array is on the bench — which is a derivation, not an assumption, because the subsets
 * are exhaustive by construction.
 *
 * ⚠ `"0"` IS A HOLE, NOT A PLAYER. Sleeper writes an unfilled starting slot as the string "0";
 * counting it would inflate the starter count and put a phantom in the depth maths.
 */
export function getRosterSlotsByPlayerId(
  playerData: unknown,
): Map<string, 'starter' | 'bench' | 'ir' | 'taxi'> {
  const slots = new Map<string, 'starter' | 'bench' | 'ir' | 'taxi'>()
  for (const id of getRosterPlayerIds(playerData)) {
    const v = String(id ?? '').trim()
    if (!v || v === '0') continue
    slots.set(v, 'bench')
  }
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return slots

  const d = playerData as Record<string, unknown>
  const sections: Array<[string, 'starter' | 'ir' | 'taxi']> = [
    ['starters', 'starter'],
    ['reserve', 'ir'],
    ['ir', 'ir'],
    ['taxi', 'taxi'],
  ]
  for (const [key, slot] of sections) {
    const raw = d[key]
    if (!Array.isArray(raw)) continue
    for (const x of raw) {
      const v = x == null ? '' : String(typeof x === 'object' ? ((x as any)?.id ?? (x as any)?.player_id ?? '') : x).trim()
      if (!v || v === '0') continue
      slots.set(v, slot)
    }
  }
  return slots
}
