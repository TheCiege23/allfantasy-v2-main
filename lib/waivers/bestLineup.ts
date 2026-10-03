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
  /** Starting slots nobody could fill — a bye, an injury, or a position you do not roster. */
  unfilled: string[]
} {
  const positions = [...new Set(players.map((p) => (p.position ?? '').toUpperCase()))]
  const breadth = (slot: string) => positions.filter((pos) => fits(slot, pos)).length
  const ordered = [...slots].sort((a, b) => breadth(a) - breadth(b))

  const pool = [...players].sort((a, b) => b.points - a.points)
  const used = new Set<string>()
  const unfilled: string[] = []
  let total = 0

  for (const slot of ordered) {
    const pick = pool.find((p) => !used.has(p.sleeperId) && fits(slot, p.position))
    if (!pick) {
      unfilled.push(slot)
      continue
    }
    used.add(pick.sleeperId)
    total += pick.points
  }
  return { total: Math.round(total * 100) / 100, used, unfilled }
}

/**
 * What kickoff has already settled about a lineup, for the week being played.
 *
 * A player whose game has kicked off is locked where he is on every launch platform: a starter can
 * no longer be benched, and a bench player can no longer be brought in.
 */
export interface LineupLocks {
  /** Index into the league's starting slots → the locked starter sitting in it. */
  pinned: ReadonlyMap<number, string>
  /** Players who cannot enter the lineup: on the bench when their game kicked off. */
  frozenOut: ReadonlySet<string>
}

export const NO_LOCKS: LineupLocks = { pinned: new Map(), frozenOut: new Set() }

/**
 * `bestLineup` with kickoff respected: locked starters keep their slots (and their points), locked
 * bench players stay out, and only the open slots are re-solved from the players still movable.
 *
 * ⚠ WITHOUT THIS THE "BEST LINEUP" INCLUDED MOVES NOBODY CAN MAKE. Elimination Station 2,
 * 2026-10-03: Rico Dowdle scored 9.8 from the bench on Thursday night, and on Saturday the board
 * still seated him over a starter who had not played — a lineup that no longer exists, about 5
 * points above any lineup the manager can field, and the base every free agent was measured against.
 *
 * A pinned starter with no projection contributes nothing rather than a guess.
 */
export function lockedBestLineup(
  players: readonly Scored[],
  slots: readonly string[],
  locks: LineupLocks,
  fits: (slot: string, position: string | null) => boolean = canFillSlot,
): ReturnType<typeof bestLineup> {
  if (locks.pinned.size === 0 && locks.frozenOut.size === 0) return bestLineup(players, slots, fits)
  const pinnedIds = new Set(locks.pinned.values())
  const open = slots.filter((_, i) => !locks.pinned.has(i))
  const pinnedPoints = players.filter((p) => pinnedIds.has(p.sleeperId)).reduce((sum, p) => sum + p.points, 0)
  const movable = players.filter((p) => !pinnedIds.has(p.sleeperId) && !locks.frozenOut.has(p.sleeperId))
  const solved = bestLineup(movable, open, fits)
  return {
    total: Math.round((solved.total + pinnedPoints) * 100) / 100,
    used: new Set([...solved.used, ...pinnedIds]),
    unfilled: solved.unfilled,
  }
}
