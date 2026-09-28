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

export type LedgerPick = { season?: unknown; round?: unknown; resolved?: { name?: unknown } | null }
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

function namesFor(row: ReadonlyArray<RowPick>, ledger: ReadonlyArray<LedgerPick>): Array<string | null> {
  const used = new Set<number>()
  return row.map((p) => {
    const k = keyOf(p.season, p.round)
    const i = ledger.findIndex((l, idx) => !used.has(idx) && keyOf(l.season, l.round) === k)
    if (i < 0) return null
    used.add(i)
    const name = ledger[i]!.resolved?.name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  })
}

/**
 * Printable picks with their drafted players attached: `drafted` for the grader, and the player in
 * the label ("2026 8th · Alec Pierce") so a value printed beside it is visibly that player's.
 * `names` must be index-aligned with `picks` — both come from `pickAssets` over the same column.
 */
export function withDraftedNames<T extends { name: string }>(
  picks: ReadonlyArray<T>,
  names: ReadonlyArray<string | null> | undefined,
): Array<T & { drafted: string | null }> {
  return picks.map((p, i) => {
    const drafted = names && names.length === picks.length ? names[i] ?? null : null
    return { ...p, name: drafted ? `${p.name} · ${drafted}` : p.name, drafted }
  })
}

export function draftedPickNamesForRow(
  row: { picksIn: ReadonlyArray<RowPick>; picksOut: ReadonlyArray<RowPick>; partnerRosterId: number | null },
  sides: ReadonlyArray<LedgerTradeSide> | null | undefined,
): { picksIn: Array<string | null>; picksOut: Array<string | null> } | null {
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
  return { picksIn: namesFor(row.picksIn, picksOf(side.picksIn)), picksOut: namesFor(row.picksOut, picksOf(side.picksOut)) }
}
