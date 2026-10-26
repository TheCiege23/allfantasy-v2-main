/**
 * How many players a team may hold, and which ones count — ONE answer for waivers, free-agent adds
 * and trades, read from the same roster the draft is sized from.
 *
 * The draft (lib/draft/syncDraftRoundsToRoster.ts) and the redraft trade runtime
 * (lib/trade-runtime/resolveNflRedraftTradeRuntime.ts) size a team from the saved roster slots and
 * keep IR / taxi out of it: 4 UTIL + 1 Super UTIL + 4 BN + 1 IR is NINE active players, with the IR
 * spot for an injured player on top. Waivers and the league trade engine instead compared EVERY
 * player against `League.rosterSize` (the total, IR included, 10). So a team with an empty IR spot
 * could claim a 10th healthy player the lineup has no room for, while a trade sending the same
 * player was refused.
 *
 * When the league has saved roster slots, the limit is the active one (starters + bench) and a
 * player sitting in IR / taxi / devy does not count against it — the same rule as the trade runtime.
 * A league with no saved slots (an import, or legacy state) keeps the old rule — everyone counts
 * against `League.rosterSize` — with ONE exception: a taxi-squad player never counts. Sleeper's and
 * Fleaflicker's `rosterSize` is the active roster (Fleaflicker's fixture: 8 starters + 7 bench = 15),
 * and Yahoo MLB/NHL now leaves its `NA` minors slots — the taxi squad — out of it, so counting a taxi
 * player told a dynasty team with a full taxi squad that its roster was full (2026-10-26). ⚠ MFL's
 * `rosterSize` is its starters plus taxi with no bench at all, already far below a real roster; this
 * only loosens it. Fantrax's minors limit is not captured (contracts/fantrax/GAPS.md F-04).
 */
import { isReserveRosterSlot, resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'

export type RosterLimit = {
  limit: number
  /** 'active': IR / taxi / devy players are not counted. 'all': every player but the taxi squad counts (legacy). */
  counts: 'active' | 'all'
}

export function leagueRosterLimit(
  league: { sport?: string | null; settings?: unknown; rosterSize?: number | null },
  fallback: number,
): RosterLimit {
  const config = resolveRedraftRosterConfig(String(league.sport ?? 'NFL'), league.settings ?? null)
  if (config.source === 'commissioner') {
    return { limit: Math.max(1, config.maxRosterSize - config.irSlots - config.taxiSlots), counts: 'active' }
  }
  return { limit: league.rosterSize ?? fallback, counts: 'all' }
}

type Row = string | { id?: unknown; player_id?: unknown } | null | undefined
const rowId = (row: Row): string =>
  typeof row === 'string' ? row : row && typeof row === 'object' ? String(row.id ?? row.player_id ?? '') : ''

/** Players sitting in a reserve spot (IR / taxi / devy), from the lineup sections or the flat arrays. */
export function reservePlayerIds(playerData: unknown): Set<string> {
  const out = new Set<string>()
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return out
  const data = playerData as Record<string, unknown>
  const sections = data.lineup_sections && typeof data.lineup_sections === 'object' ? (data.lineup_sections as Record<string, unknown>) : {}
  for (const [key, rows] of [...Object.entries(sections), ['reserve', data.reserve], ['taxi', data.taxi], ['ir', data.ir]] as const) {
    if (!isReserveRosterSlot(key) || !Array.isArray(rows)) continue
    for (const row of rows as Row[]) {
      const id = rowId(row)
      if (id) out.add(id)
    }
  }
  return out
}

/** Players on the taxi squad, from `lineup_sections.taxi` or the flat `taxi` array. */
export function taxiPlayerIds(playerData: unknown): Set<string> {
  const out = new Set<string>()
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return out
  const data = playerData as Record<string, unknown>
  const sections = data.lineup_sections && typeof data.lineup_sections === 'object' ? (data.lineup_sections as Record<string, unknown>) : {}
  for (const rows of [sections.taxi, data.taxi]) {
    if (!Array.isArray(rows)) continue
    for (const row of rows as Row[]) {
      const id = rowId(row)
      if (id) out.add(id)
    }
  }
  return out
}

/** How many of this roster's players count against `limit`. */
export function countTowardRosterLimit(playerData: unknown, counts: RosterLimit['counts']): number {
  const ids = getRosterPlayerIds(playerData)
  if (counts === 'all') {
    const taxi = taxiPlayerIds(playerData)
    return ids.filter((id) => !taxi.has(id)).length
  }
  const reserve = reservePlayerIds(playerData)
  return ids.filter((id) => !reserve.has(id)).length
}
