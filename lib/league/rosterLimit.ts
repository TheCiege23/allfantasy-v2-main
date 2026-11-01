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
 *
 * IMPORTED leagues (lib/league/isNativeLeague.ts) also leave IR out ('imported'), owner's call
 * 2026-10-26. Sleeper's `rosterSize` is `roster_positions.length` (lib/sleeper-sync.ts), which holds
 * no IR spots — they are `settings.reserve_slots` — so an injured player counted against a limit that
 * never had room for him: 191 of 200 taxi-configured Sleeper NFL leagues had a team over its own
 * limit with taxi aside, 40 with IR aside too. A player counts by the SLOT the provider filed him in,
 * not his injury status, so one who has recovered stays out of the count until a sync moves him.
 * Native leagues keep 'all' / 'active' exactly as they were.
 */
import { isImportedPlatform } from '@/lib/league/isNativeLeague'
import { isInjuredReserveRosterSlot, isReserveRosterSlot, resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'

export type RosterLimit = {
  limit: number
  /**
   * 'active': IR / taxi / devy players are not counted. 'all': every player but the taxi squad counts
   * (native legacy). 'imported': every player but the taxi squad and IR counts.
   */
  counts: 'active' | 'all' | 'imported'
  /** 'imported' only: the provider's IR spot count when the import recorded one, else null. */
  irSlots?: number | null
}

type LimitLeague = {
  sport?: string | null
  settings?: unknown
  rosterSize?: number | null
  /** `League.platform`. Omitted reads as native, the stricter count — select it. */
  platform?: string | null
  /** `League.irSlots` — 0 by default, so only a positive value is evidence on its own. */
  irSlots?: number | null
}

/**
 * The provider's IR spot count, or null when the import did not record one. Sleeper's
 * `settings.reserve_slots` is authoritative even at 0; `League.irSlots` defaults to 0 on every row,
 * so it counts only when positive (every ESPN import reads 0 there although ESPN has IR spots).
 */
function importedIrSlots(league: LimitLeague): number | null {
  const s = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
  const reserve = s.reserve_slots
  if (reserve != null && reserve !== '' && Number.isFinite(Number(reserve))) return Math.max(0, Math.floor(Number(reserve)))
  return league.irSlots != null && league.irSlots > 0 ? league.irSlots : null
}

export function leagueRosterLimit(league: LimitLeague, fallback: number): RosterLimit {
  const config = resolveRedraftRosterConfig(String(league.sport ?? 'NFL'), league.settings ?? null)
  if (config.source === 'commissioner') {
    return { limit: Math.max(1, config.maxRosterSize - config.irSlots - config.taxiSlots), counts: 'active' }
  }
  const limit = league.rosterSize ?? fallback
  if (isImportedPlatform(league.platform)) return { limit, counts: 'imported', irSlots: importedIrSlots(league) }
  return { limit, counts: 'all' }
}

type Row = string | { id?: unknown; player_id?: unknown } | null | undefined
const rowId = (row: Row): string =>
  typeof row === 'string' ? row : row && typeof row === 'object' ? String(row.id ?? row.player_id ?? '') : ''

/** Ids in every lineup section / flat array whose key passes `keep`. */
function idsInSlots(playerData: unknown, keep: (key: string) => boolean): Set<string> {
  const out = new Set<string>()
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return out
  const data = playerData as Record<string, unknown>
  const sections = data.lineup_sections && typeof data.lineup_sections === 'object' ? (data.lineup_sections as Record<string, unknown>) : {}
  for (const [key, rows] of [...Object.entries(sections), ['reserve', data.reserve], ['taxi', data.taxi], ['ir', data.ir]] as const) {
    if (!keep(key) || !Array.isArray(rows)) continue
    for (const row of rows as Row[]) {
      const id = rowId(row)
      if (id) out.add(id)
    }
  }
  return out
}

/** Players sitting in a reserve spot (IR / taxi / devy), from the lineup sections or the flat arrays. */
export function reservePlayerIds(playerData: unknown): Set<string> {
  return idsInSlots(playerData, isReserveRosterSlot)
}

/** Players on the taxi squad, from `lineup_sections.taxi` or the flat `taxi` array. */
export function taxiPlayerIds(playerData: unknown): Set<string> {
  return idsInSlots(playerData, (key) => key === 'taxi')
}

/** Players on IR — `lineup_sections.ir`, the flat `reserve` / `ir` arrays — never taxi or devy. */
export function irPlayerIds(playerData: unknown): Set<string> {
  return idsInSlots(playerData, isInjuredReserveRosterSlot)
}

/**
 * The roster's players that do NOT count against the limit. Every check that adds, drops or moves a
 * player reads this one set, so a player leaving from an uncounted spot frees nothing.
 */
export function uncountedPlayerIds(playerData: unknown, counts: RosterLimit['counts']): Set<string> {
  if (counts === 'active') return reservePlayerIds(playerData)
  const out = taxiPlayerIds(playerData)
  if (counts === 'imported') for (const id of irPlayerIds(playerData)) out.add(id)
  return out
}

/** How many of this roster's players count against `limit`. */
export function countTowardRosterLimit(playerData: unknown, counts: RosterLimit['counts']): number {
  const uncounted = uncountedPlayerIds(playerData, counts)
  return getRosterPlayerIds(playerData).filter((id) => !uncounted.has(id)).length
}

/**
 * An imported roster holding more IR players than the provider has IR spots. Reported, never
 * enforced: the provider is the system of record for its own IR, and an over-full IR there is the
 * provider's state, not a move made here. Null when the count is fine or the slot count is unknown.
 */
export function importedIrOverflow(playerData: unknown, rosterLimit: RosterLimit): { held: number; slots: number } | null {
  if (rosterLimit.counts !== 'imported' || rosterLimit.irSlots == null) return null
  const onRoster = new Set(getRosterPlayerIds(playerData))
  const held = [...irPlayerIds(playerData)].filter((id) => onRoster.has(id)).length
  return held > rosterLimit.irSlots ? { held, slots: rosterLimit.irSlots } : null
}
