import type { LineupSlot } from './myTeam'

/**
 * One answer to "is my lineup right?", over facts the roster rows already carry.
 *
 * WHY. Every input here was already on the screen — the OUT chip, the BYE badge, the empty
 * slot, the per-row bench check — but spread across sixteen rows. A manager who wanted to know
 * whether to do anything had to read all of them, and on a phone the first starter sat 1,500px
 * down. This rolls them into one list, ordered by how certain the loss is.
 *
 * Rules, each borrowed from the row it summarises, never re-derived:
 *  - OUT, bye and empty are certain zeros (the board's rule — `MyTeamBoard.tsx`).
 *  - Questionable is a warning, not a loss: he probably plays.
 *  - A bench swap is offered only when the per-row check said `swap` — past the
 *    BENCH_SWAP_POINTS margin. `close` is the row's own "starter is fine".
 *  - A starter whose game has kicked off is skipped: he is locked, so advice about him is noise.
 *
 * Pure and client-safe (type-only import).
 */

export type LineupCheckItem = {
  kind: 'out' | 'bye' | 'empty' | 'swap' | 'questionable'
  slotLabel: string
  /** The starter's name; null for an empty slot. */
  name: string | null
  /** The starter's roster id; null for an empty slot. */
  playerId: string | null
  /** Row anchor on this page, so the item can jump to it. */
  anchor: string
  /** The bench player who should take the slot, when the row's check found one. */
  replacement: { name: string; projected: number; gain: number | null } | null
}

export type LineupCheck = {
  items: LineupCheckItem[]
  /** Starters already past kickoff — reported, never advised on. */
  locked: number
}

const RANK: Record<LineupCheckItem['kind'], number> = { out: 0, bye: 1, empty: 2, swap: 3, questionable: 4 }

export function summariseLineupCheck(starters: readonly LineupSlot[]): LineupCheck {
  const items: LineupCheckItem[] = []
  let locked = 0
  starters.forEach((slot, i) => {
    const p = slot.player
    const anchor = p ? `lineup-player-${p.sleeperId}` : `lineup-slot-${i}`
    if (slot.empty) {
      items.push({ kind: 'empty', slotLabel: slot.slotLabel, name: null, playerId: null, anchor, replacement: null })
      return
    }
    if (!p) return // unresolved id: the identity note already speaks for it
    if (p.gameDay && p.gameDay.state !== 'upcoming') {
      locked++
      return
    }
    const check = slot.benchCheck
    const replacement =
      check && check.verdict === 'swap'
        ? {
            name: check.benchName,
            projected: check.benchProjected,
            gain: Math.round((check.benchProjected - check.starterProjected) * 10) / 10,
          }
        : null
    const status = String(p.injuryStatus ?? '').toLowerCase()
    const kind: LineupCheckItem['kind'] | null = p.ruledOut
      ? 'out'
      : p.onBye
        ? 'bye'
        : replacement
          ? 'swap'
          : status.includes('question') || status.includes('doubt')
            ? 'questionable'
            : null
    if (kind) items.push({ kind, slotLabel: slot.slotLabel, name: p.name, playerId: p.sleeperId, anchor, replacement })
  })
  items.sort((a, b) => RANK[a.kind] - RANK[b.kind])
  return { items, locked }
}
