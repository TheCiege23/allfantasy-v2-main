/**
 * Fill an empty starting spot before lock (phase 7, 2026-10-29) — anti-tanking's last gap.
 *
 * The tanking monitor FLAGS a lineup with an empty starting spot after the fact; the team still
 * scored nothing from it. A brand-new team that never set a lineup starts nobody at all. With this
 * on (the default; the commissioner can switch it off), the hourly run puts the best bench player who
 * can play into each empty starting spot.
 *
 * ONLY EMPTY SPOTS ARE FILLED. Every player the manager started stays exactly where they put him —
 * even one on bye or hurt: moving a manager's own choice is "optimize my lineup", which is a
 * different setting (`./autoBenchByePolicy.ts` for byes). A bench player whose game has started, or
 * who is on bye, is never brought in. When a spot cannot be filled — nobody on the bench can play
 * it — that spot stays empty and the commissioner is told; the spots that can be filled still are.
 *
 * Stored as `League.settings.fill_empty_starters`; absent means on. Pure.
 */
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import type { LineupPlayerInfo } from '@/lib/league/native/nativeScreenModels'
import { buildLineupListsFromPlayerData, playerEligibleForSlot } from '@/lib/league/lineup-swap'
import { buildPlayerDataFromSections, getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

export const FILL_EMPTY_STARTERS_KEY = 'fill_empty_starters'

/** A lineup untouched for this long is not being edited; a shorter gap may be a manager mid-change. */
export const FILL_EMPTY_STARTERS_IDLE_MS = 3 * 60 * 60 * 1000

export function fillEmptyStartersOn(leagueSettings: unknown): boolean {
  const s = leagueSettings && typeof leagueSettings === 'object' ? (leagueSettings as Record<string, unknown>) : {}
  return s[FILL_EMPTY_STARTERS_KEY] !== false
}

/** Starting spots with nobody in them, by slot index. */
export function emptyStarterSlots(playerData: unknown, slotCount: number): number[] {
  const starters = buildLineupListsFromPlayerData(playerData, slotCount).starters
  const out: number[] = []
  for (let i = 0; i < slotCount; i++) if (!starters[i]) out.push(i)
  return out
}

export type FillEmptyStartersPlan =
  | {
      kind: 'set'
      nextPlayerData: Record<string, unknown>
      changes: Array<{ slot: string; in: string }>
      /** Spots still empty because nobody on the bench can play them. */
      unfilled: string[]
    }
  | { kind: 'skip'; reason: 'no_empty_starters' }
  | { kind: 'cannot_fill'; unfilled: string[] }

/**
 * The lineup with each empty starting spot filled by the best bench player who can play it, or why
 * not. `isLocked` names players whose game has started; `onBye` names players with no game this week.
 *
 * The hardest spot to fill is filled first (fewest bench players can play it), so a FLEX does not take
 * the only tight end a TE spot needed. Within a spot, the highest projection wins; a player with no
 * projection still beats an empty spot.
 */
export function planFillEmptyStarters(args: {
  slots: ExpandedStarterSlot[]
  playerData: unknown
  players: Record<string, LineupPlayerInfo | undefined>
  isLocked: (playerId: string) => boolean
  onBye: (playerId: string) => boolean
}): FillEmptyStartersPlan {
  const { slots } = args
  const lists = buildLineupListsFromPlayerData(args.playerData, slots.length)
  const empty = emptyStarterSlots(args.playerData, slots.length)
  if (empty.length === 0) return { kind: 'skip', reason: 'no_empty_starters' }

  const sections = getNormalizedLineupSections(args.playerData)
  const rows = new Map<string, Record<string, unknown>>()
  for (const r of [...sections.starters, ...sections.bench]) rows.set(String(r.id), r)
  const position = (id: string) => (rows.get(id)?.position as string | undefined) ?? args.players[id]?.position ?? null
  const projection = (id: string) => {
    const v = args.players[id]?.projectedPoints
    return typeof v === 'number' && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY
  }

  // Every starter stays put; a bench player who cannot play this week is never brought in.
  const available = new Set(lists.bench.filter((id) => id && !args.isLocked(id) && !args.onBye(id)))
  const canPlay = (i: number) => [...available].filter((id) => playerEligibleForSlot(slots[i], position(id)))
  const order = [...empty].sort((a, b) => canPlay(a).length - canPlay(b).length || a - b)

  const starters = [...lists.starters]
  const changes: Array<{ slot: string; in: string }> = []
  const unfilled: string[] = []
  for (const i of order) {
    const best = canPlay(i).sort((a, b) => projection(b) - projection(a))[0]
    const label = slots[i]?.label ?? `#${i + 1}`
    if (!best) {
      unfilled.push(label)
      continue
    }
    available.delete(best)
    starters[i] = best
    changes.push({ slot: label, in: best })
  }
  if (changes.length === 0) return { kind: 'cannot_fill', unfilled }

  const moved = new Set(changes.map((c) => c.in))
  const starterRows = starters.flatMap((id, slotIndex) =>
    id ? [{ ...(rows.get(id) ?? { id, position: position(id) ?? 'UTIL' }), slotIndex }] : [],
  )
  const benchRows = sections.bench.filter((r) => !moved.has(String(r.id)))
  return {
    kind: 'set',
    nextPlayerData: buildPlayerDataFromSections(args.playerData, { ...sections, starters: starterRows, bench: benchRows }),
    changes: changes.sort((a, b) => slots.findIndex((s) => s.label === a.slot) - slots.findIndex((s) => s.label === b.slot)),
    unfilled,
  }
}
