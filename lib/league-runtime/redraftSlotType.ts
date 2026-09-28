/**
 * The ONE rule for projecting a roster's lineup (`Roster.playerData`) onto the redraft engines'
 * per-player slot (`RedraftRosterPlayer.slotType`).
 *
 * `Roster.playerData` is where a roster lives; `RedraftRosterPlayer` is the projection the redraft
 * engines read — weekly scoring (`lib/redraft/weekFinalizer.ts`, `scoringEngine.ts`) decides who
 * scores from `slotType`. Two writers keep the projection: `materializeRedraftRosterPlayers` when it
 * CREATES rows, and the lineup engine (`lib/roster-lineup-engine/redraftSlotSync.ts`) on every
 * native lineup save. They share these functions so they cannot disagree about what a slot is.
 *
 * Pure and dependency-free (moved out of materializeRedraftRosterPlayers.ts, 2026-09-27).
 */

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function idOf(entry: unknown): string {
  if (typeof entry === 'string') return entry
  const r = asRecord(entry)
  return String(r.id ?? r.player_id ?? '')
}

/**
 * Every player id the roster names anywhere — the flat list, starters, IR, taxi and every lineup
 * section. A player is only gone when he appears on NONE of them.
 */
export function idsOnAnyRosterList(playerData: unknown): Set<string> {
  const data = asRecord(playerData)
  const ids = new Set<string>()
  const add = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const entry of list) {
      const id = idOf(entry)
      if (id) ids.add(id)
    }
  }
  add(data.players)
  add(data.starters)
  add(data.reserve)
  add(data.taxi)
  for (const section of Object.values(asRecord(data.lineup_sections ?? data.lineupSections))) add(section)
  return ids
}

/**
 * Which slot a player occupies, in the vocabulary already stored in this table.
 *
 * ⚠ A STARTER'S SLOT IS THEIR POSITION, NOT THE WORD "starter" — that is the existing convention,
 * confirmed against production where `WR`, `RB`, `QB`, `TE`, `DEF` and `K` all appear as slot types
 * alongside `bench`, `taxi` and `ir`. `normalizeSlotType` in `finalizeDraftToRedraftSeason` does the
 * same thing, and writing a different vocabulary here would split one column between two meanings.
 *
 * ⚠ NOT SHARED WITH THAT FUNCTION, DELIBERATELY. It matches a DRAFT PICK, which may carry no id and
 * so has to fuzzy-match on name; this matches a roster entry, which always has one. Same output
 * vocabulary, genuinely different matcher — sharing would mean giving the id-based case a name
 * fallback it does not need and cannot exercise.
 */
export function slotTypeFor(playerData: unknown, playerId: string, position: string | null): string {
  const data = asRecord(playerData)

  const starters = data.starters
  if (Array.isArray(starters) && starters.some((e) => idOf(e) === playerId)) {
    return position || 'starter'
  }

  const sections = asRecord(data.lineup_sections ?? data.lineupSections)
  for (const [name, value] of Object.entries(sections)) {
    if (!Array.isArray(value)) continue
    if (!value.some((e) => idOf(e) === playerId)) continue
    const s = name.trim().toLowerCase()
    if (s === 'starters' || s === 'starter' || s === 'lineup') return position || 'starter'
    if (s === 'bench' || s === 'bn' || s === 'reserve') return 'bench'
    if (s === 'taxi') return 'taxi'
    if (s === 'ir') return 'ir'
    if (s === 'devy') return 'devy'
    return s
  }

  /*
   * The top-level `reserve` array is IR on every provider that writes it — the same reading
   * `lib/league-import` applies. Checked after `lineup_sections` so an explicit section wins.
   */
  const reserve = data.reserve
  if (Array.isArray(reserve) && reserve.some((e) => idOf(e) === playerId)) return 'ir'
  const taxi = data.taxi
  if (Array.isArray(taxi) && taxi.some((e) => idOf(e) === playerId)) return 'taxi'

  return 'bench'
}

export type SlotCategory = 'starter' | 'bench' | 'ir' | 'taxi' | 'devy'

/**
 * What a slot MEANS to the engines — the unit the save path compares, so a starter already stored
 * as `FLEX` is not rewritten to `RB` (both start; other readers of the exact label see no churn).
 * Mirrors the non-scoring set in `canonicalNflRedraftScoringRuntime` (bench/bn/ir/reserve/taxi/devy);
 * anything else is a starter slot.
 */
export function slotCategory(slotType: string | null | undefined): SlotCategory {
  const s = String(slotType ?? '').trim().toLowerCase()
  if (s === 'bench' || s === 'bn') return 'bench'
  if (s === 'ir' || s === 'reserve') return 'ir'
  if (s === 'taxi') return 'taxi'
  if (s === 'devy') return 'devy'
  return 'starter'
}

/**
 * The lineup as the lineup ENGINE saw it: `lineup_sections` alone, when present.
 *
 * ⚠ THE LEGACY TOP-LEVEL `starters` CAN BE STALE, AND `slotTypeFor` READS IT FIRST.
 * `/api/leagues/roster/save` merges the client's payload OVER the stored `playerData`, so a client
 * that sends only `lineup_sections` leaves the previous `starters` array standing beside it. The
 * engine validates `lineup_sections` and nothing else (`getNormalizedLineupSections`), and
 * `af_roster_lineup_assignments` records the same — so on the save path that is the lineup, and a
 * benched player still named in a stale `starters` must not keep scoring. Without sections (an
 * older shape), the whole object is the only evidence there is.
 */
export function engineLineupView(playerData: unknown): unknown {
  const data = asRecord(playerData)
  const sections = data.lineup_sections
  if (sections && typeof sections === 'object' && !Array.isArray(sections)) return { lineup_sections: sections }
  return playerData
}

/**
 * The slot changes a saved lineup implies for a roster's live projection rows: one entry per row
 * whose CATEGORY differs from where the lineup now puts that player. A row for a player the lineup
 * names nowhere is left alone — retiring players is the materializer's and the drop paths' job,
 * not the lineup save's.
 */
export function redraftSlotChanges(
  savedPlayerData: unknown,
  rows: ReadonlyArray<{ id: string; playerId: string; position: string | null; slotType: string }>,
): Array<{ id: string; playerId: string; from: string; to: string }> {
  const playerData = engineLineupView(savedPlayerData)
  const onRoster = idsOnAnyRosterList(playerData)
  const out: Array<{ id: string; playerId: string; from: string; to: string }> = []
  for (const row of rows) {
    if (!onRoster.has(row.playerId)) continue
    const to = slotTypeFor(playerData, row.playerId, row.position)
    if (slotCategory(to) === slotCategory(row.slotType)) continue
    out.push({ id: row.id, playerId: row.playerId, from: row.slotType, to })
  }
  return out
}
