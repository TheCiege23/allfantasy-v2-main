import { canFillSlot } from '@/lib/core-app/slotEligibility'

/*
 * The lineup solver behind every "what does this add do to YOUR lineup" figure — the per-league
 * Waivers board (`waiverBoard.ts`) and the cross-league board (`lib/core-app/waiverSwap.ts`).
 * Pure, so both can share one rule: the two boards used to answer different questions, and the
 * cross-league one recommended backup quarterbacks the league screen said would never start.
 */

export interface Scored {
  sleeperId: string
  name: string
  position: string | null
  team: string | null
  points: number
  basis?: 'projection' | 'form'
  formGames?: number
}

/**
 * Best starting lineup by projected points.
 *
 * ⚠ MOST-RESTRICTIVE SLOT FIRST, OR FLEX EATS THE STARTERS. Filling in roster order lets a FLEX
 * take the best running back before the dedicated RB slots are considered, which leaves a real
 * starting slot empty and undervalues every subsequent candidate. Sorting slots by how many of
 * the available positions can fill them puts dedicated slots ahead of flex automatically, with
 * no list of which slots are "flex" to keep in sync.
 *
 * `fits` is football's `canFillSlot` unless a caller names its sport's rule (sportSlotEligibility.ts).
 * `Scored.sleeperId` is used here only as an identity key for "already seated".
 */
export function bestLineup(
  players: readonly Scored[],
  slots: readonly string[],
  fits: (slot: string, position: string | null) => boolean = canFillSlot,
): {
  total: number
  used: Set<string>
} {
  const positions = [...new Set(players.map((p) => (p.position ?? '').toUpperCase()))]
  const breadth = (slot: string) => positions.filter((pos) => fits(slot, pos)).length
  const ordered = [...slots].sort((a, b) => breadth(a) - breadth(b))

  const pool = [...players].sort((a, b) => b.points - a.points)
  const used = new Set<string>()
  let total = 0

  for (const slot of ordered) {
    const pick = pool.find((p) => !used.has(p.sleeperId) && fits(slot, p.position))
    if (!pick) continue
    used.add(pick.sleeperId)
    total += pick.points
  }
  return { total: Math.round(total * 100) / 100, used }
}
