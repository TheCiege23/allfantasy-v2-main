/**
 * Pure view helpers for the draft lottery page (components/draft/LotteryDraw.tsx).
 * No I/O: the page and its tests feed in what the state endpoint returns.
 */

export type LotteryOddsTeam = {
  rosterId: string
  displayName: string
  /** 1 = best record in the league. */
  rank: number
  wins?: number
  losses?: number
  ties?: number
  oddsPercent: number
}

export type LotteryDraw = { pickSlot: number; rosterId: string; displayName: string }
export type SlotEntry = { slot: number; rosterId: string; displayName: string }

/** Worst record first — the order the odds table reads, and the order the record alone would draft in. */
export function worstFirst<T extends { rank: number }>(teams: readonly T[]): T[] {
  return teams.slice().sort((a, b) => b.rank - a.rank)
}

/** Where each lottery team would pick on record alone: worst record = 1. */
export function projectedSlots(teams: readonly LotteryOddsTeam[]): Map<string, number> {
  return new Map(worstFirst(teams).map((t, i) => [t.rosterId, i + 1]))
}

export type Movement = { direction: 'up' | 'down' | 'same'; by: number; from: number | null }

/** How far a team moved against its projected slot. Unknown projection → 'same'. */
export function movementFor(rosterId: string, pickSlot: number, projected: Map<string, number>): Movement {
  const from = projected.get(rosterId) ?? null
  if (from == null || from === pickSlot) return { direction: 'same', by: 0, from }
  return from > pickSlot ? { direction: 'up', by: from - pickSlot, from } : { direction: 'down', by: pickSlot - from, from }
}

/** Reveal order: the last lottery pick first, building to No. 1. */
export function revealSequence(draws: readonly LotteryDraw[]): LotteryDraw[] {
  return draws.slice().sort((a, b) => b.pickSlot - a.pickSlot)
}

/** Teams still in after `revealed` draws, worst record first. */
export function stillIn(teams: readonly LotteryOddsTeam[], revealed: readonly LotteryDraw[]): LotteryOddsTeam[] {
  const out = new Set(revealed.map((d) => d.rosterId))
  return worstFirst(teams.filter((t) => !out.has(t.rosterId)))
}

/** "3–11" or "6–7–1". */
export function formatRecord(team: Pick<LotteryOddsTeam, 'wins' | 'losses' | 'ties'>): string | null {
  if (typeof team.wins !== 'number' || typeof team.losses !== 'number') return null
  return team.ties ? `${team.wins}–${team.losses}–${team.ties}` : `${team.wins}–${team.losses}`
}

/** "17.5%", "25%". */
export function formatOdds(percent: number): string {
  const rounded = Math.round(percent * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

/** Odds bar width relative to the best odds on the board (0–100). */
export function oddsBarPercent(percent: number, teams: readonly LotteryOddsTeam[]): number {
  const max = Math.max(0, ...teams.map((t) => t.oddsPercent))
  return max > 0 ? Math.round((percent / max) * 100) : 0
}

/**
 * Whether the session's draft order IS this lottery result — i.e. the commissioner locked it in.
 * Compares roster per slot; names can be edited afterwards and do not matter.
 */
export function isSameSlotOrder(a: readonly SlotEntry[] | null | undefined, b: readonly SlotEntry[] | null | undefined): boolean {
  if (!a?.length || !b?.length || a.length !== b.length) return false
  const bySlot = (rows: readonly SlotEntry[]) => new Map(rows.map((r) => [r.slot, r.rosterId]))
  const ma = bySlot(a)
  const mb = bySlot(b)
  if (ma.size !== mb.size) return false
  for (const [slot, rosterId] of ma) if (mb.get(slot) !== rosterId) return false
  return true
}
