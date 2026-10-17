/**
 * Pair an archived trade row's picks with what the graded ledger says each became. PURE — no
 * prisma, no clock — so the matching rules are asserted directly.
 *
 * The row is ONE manager's copy of the trade; the ledger holds every side of it. The row's side is
 * found by its picks: the side whose picks in and out are exactly the row's, as (season, round)
 * multisets, excluding the partner's roster when the row names it. Anything other than exactly one
 * such side returns null — a guess here would put one manager's drafted player on another's card.
 *
 * ⚠ TWO IDENTICAL PICKS ON ONE SIDE (two 2027 1sts) are paired in the ledger's order. The row
 * cannot tell them apart either, so which label gets which name is arbitrary — but the SET of
 * drafted players is right, and so is every total and letter graded from it.
 */

export type LedgerPick = { season?: unknown; round?: unknown; resolved?: { name?: unknown; playerId?: unknown } | null }
export type LedgerTradeSide = { rosterId?: unknown; picksIn?: unknown; picksOut?: unknown }

type RowPick = { season: string | number | null; round: number | null }

const keyOf = (season: unknown, round: unknown): string | null => {
  const s = String(season ?? '').trim()
  const r = Number(round)
  return s && Number.isInteger(r) && r > 0 ? `${s}:${r}` : null
}

const picksOf = (v: unknown): LedgerPick[] => (Array.isArray(v) ? (v as LedgerPick[]) : [])

function sameMultiset(row: ReadonlyArray<RowPick>, ledger: ReadonlyArray<LedgerPick>): boolean {
  if (row.length !== ledger.length) return false
  const counts = new Map<string, number>()
  for (const p of row) {
    const k = keyOf(p.season, p.round)
    if (!k) return false
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  for (const p of ledger) {
    const k = keyOf(p.season, p.round)
    if (!k || !counts.get(k)) return false
    counts.set(k, counts.get(k)! - 1)
  }
  return true
}

/** Index-aligned with the row: each pick's drafted player, and his Sleeper id when the ledger has it. */
function draftedFor(row: ReadonlyArray<RowPick>, ledger: ReadonlyArray<LedgerPick>): { names: Array<string | null>; ids: Array<string | null> } {
  const used = new Set<number>()
  const names: Array<string | null> = []
  const ids: Array<string | null> = []
  for (const p of row) {
    const k = keyOf(p.season, p.round)
    const i = ledger.findIndex((l, idx) => !used.has(idx) && keyOf(l.season, l.round) === k)
    if (i >= 0) used.add(i)
    const name = i >= 0 ? ledger[i]!.resolved?.name : null
    const id = i >= 0 ? ledger[i]!.resolved?.playerId : null
    const named = typeof name === 'string' && name.trim() ? name.trim() : null
    names.push(named)
    // An id only beside a name: the grader prices a drafted player by name AND id, never an id alone.
    ids.push(named && (typeof id === 'string' || typeof id === 'number') && String(id).trim() ? String(id).trim() : null)
  }
  return { names, ids }
}

/**
 * Printable picks with their drafted players attached: `drafted` for the grader, and the player in
 * the label ("2026 8th · Alec Pierce") so a value printed beside it is visibly that player's.
 * `names` must be index-aligned with `picks` — both come from `pickAssets` over the same column.
 */
export function withDraftedNames<T extends { name: string }>(
  picks: ReadonlyArray<T>,
  names: ReadonlyArray<string | null> | undefined,
  /** Index-aligned Sleeper ids for those players, so the grader prices them by id — see `sleeperPlayerInput`. */
  ids?: ReadonlyArray<string | null>,
): Array<T & { drafted: string | null; draftedId: string | null }> {
  const aligned = Boolean(names && names.length === picks.length)
  return picks.map((p, i) => {
    const drafted = aligned ? names![i] ?? null : null
    const draftedId = drafted && ids && ids.length === picks.length ? ids[i] ?? null : null
    return { ...p, name: drafted ? `${p.name} · ${drafted}` : p.name, drafted, draftedId }
  })
}

export function draftedPickNamesForRow(
  row: { picksIn: ReadonlyArray<RowPick>; picksOut: ReadonlyArray<RowPick>; partnerRosterId: number | null },
  sides: ReadonlyArray<LedgerTradeSide> | null | undefined,
): {
  picksIn: Array<string | null>
  picksOut: Array<string | null>
  /** Index-aligned with `picksIn` / `picksOut`: each drafted player's Sleeper id, where known. */
  idsIn: Array<string | null>
  idsOut: Array<string | null>
} | null {
  if (!sides || sides.length === 0) return null
  if (row.picksIn.length === 0 && row.picksOut.length === 0) return null
  const candidates = sides.filter(
    (s) =>
      (row.partnerRosterId == null || Number(s.rosterId) !== row.partnerRosterId) &&
      sameMultiset(row.picksIn, picksOf(s.picksIn)) &&
      sameMultiset(row.picksOut, picksOf(s.picksOut)),
  )
  if (candidates.length !== 1) return null
  const side = candidates[0]!
  const into = draftedFor(row.picksIn, picksOf(side.picksIn))
  const outOf = draftedFor(row.picksOut, picksOf(side.picksOut))
  return { picksIn: into.names, picksOut: outOf.names, idsIn: into.ids, idsOut: outOf.ids }
}
