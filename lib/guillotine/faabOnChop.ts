/**
 * What happens to a chopped team's unspent FAAB.
 *
 *   keep   nothing — the money leaves the league with the team (what every Guilly league did
 *          before this existed, so it stays the default)
 *   split  divided evenly among the teams still alive, the common chopped-league rule: the
 *          survivors fight over the chopped roster with the budget the chopped team never spent
 *
 * The budget the waiver engine spends is `Roster.faabRemaining` (lib/waiver-wire/process-engine.ts),
 * so that is what moves. A roster with no budget (FAAB off, so `faabRemaining` is null) is neither a
 * source nor a recipient.
 *
 * Pure, so the settings page can import it. The database write is in ./faabOnChopApply.ts.
 */
export type FaabOnChop = 'keep' | 'split'

/** League.settings key. Absent = keep. */
export const FAAB_ON_CHOP_KEY = 'guillotineFaabOnChop'

export const FAAB_ON_CHOP_OPTIONS: ReadonlyArray<{ value: FaabOnChop; label: string; help: string }> = [
  { value: 'keep', label: 'It leaves with the team', help: "Survivors keep the budgets they have; the chopped team's leftover is gone." },
  { value: 'split', label: 'Split it among the survivors', help: "The chopped team's leftover FAAB is shared evenly by every team still alive." },
]

export function readFaabOnChop(settings: unknown): FaabOnChop {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[FAAB_ON_CHOP_KEY] : null
  return v === 'split' ? 'split' : 'keep'
}

export type FaabSplit = {
  /** Total taken from the chopped teams. */
  pool: number
  /** rosterId → amount added. Whole dollars; the remainder goes one each to the lowest balances. */
  shares: Map<string, number>
}

/**
 * Pure. Every dollar of the pool is handed out: `floor(pool / n)` each, then the leftover dollars one
 * at a time to the survivors with the least FAAB (ties by roster id, so a retry decides the same way).
 */
export function splitChoppedFaab(pool: number, survivors: ReadonlyArray<{ rosterId: string; faab: number }>): FaabSplit {
  const shares = new Map<string, number>()
  const total = Math.max(0, Math.floor(pool))
  if (total === 0 || survivors.length === 0) return { pool: 0, shares }
  const base = Math.floor(total / survivors.length)
  let leftover = total - base * survivors.length
  const neediest = [...survivors].sort((a, b) => a.faab - b.faab || a.rosterId.localeCompare(b.rosterId))
  for (const s of neediest) {
    const extra = leftover > 0 ? 1 : 0
    leftover -= extra
    shares.set(s.rosterId, base + extra)
  }
  return { pool: total, shares }
}
