/**
 * Draft-day kit (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 9) — the printable draft board.
 *
 * Pure: the grid every live league needs on paper for an in-person draft, or a wall board. One
 * column per MANAGER (so a reader follows one team down the page) and one row per round, with the pick
 * label that snakes underneath — the same layout as the live room (lib/draft-board/draftBoardGrid.ts).
 *
 * Each cell is, in this order of precedence: the pick already made, the keeper locked into the slot,
 * or blank. A traded pick names who now owns it, because on paper there is no hover to find out.
 */

import { buildDraftBoard, cellForSlot, type DraftKind } from '@/lib/draft-board/draftBoardGrid'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { TradedPickRecord } from '@/lib/live-draft-engine/types'

export type PrintSlot = { slot: number; rosterId: string; displayName: string }
export type PrintPick = { overall: number; playerName: string; position: string; team: string | null }
export type PrintKeeper = { overall: number; playerName: string; position: string; team: string | null }

export type PrintCell = {
  label: string
  overall: number
  kind: 'pick' | 'keeper' | 'open'
  player: string | null
  detail: string | null
  /** Set when the pick has been traded away from this column's manager. */
  ownedBy: string | null
}

export type PrintBoard = {
  managers: PrintSlot[]
  rows: Array<{ round: number; reversed: boolean; cells: PrintCell[] }>
  picksMade: number
  keepers: number
}

const EMPTY_PLAYER = /^\(?skipped\)?$/i

export function buildPrintBoard(args: {
  rounds: number
  teamCount: number
  draftType: string
  thirdRoundReversal: boolean
  slotOrder: readonly PrintSlot[]
  tradedPicks: readonly TradedPickRecord[]
  picks: readonly PrintPick[]
  keepers: readonly PrintKeeper[]
}): PrintBoard {
  const kind: DraftKind = args.draftType === 'linear' ? 'linear' : 'snake'
  const managers = [...args.slotOrder].sort((a, b) => a.slot - b.slot)
  const byOverall = new Map(args.picks.filter((p) => p.playerName.trim()).map((p) => [p.overall, p]))
  const keeperAt = new Map(args.keepers.map((k) => [k.overall, k]))
  const grid = buildDraftBoard({ rounds: args.rounds, teamCount: args.teamCount, kind, thirdRoundReversal: args.thirdRoundReversal })
  const slotOrder = managers.map((m) => ({ slot: m.slot, rosterId: m.rosterId, displayName: m.displayName }))
  let picksMade = 0
  let keepers = 0

  const rows = grid.map((row) => ({
    round: row.round,
    reversed: row.reversed,
    cells: managers.map((m) => {
      const cell = cellForSlot(row, m.slot)
      const overall = cell?.overall ?? 0
      const owner = cell ? resolvePickOwner(row.round, m.slot, slotOrder, [...args.tradedPicks]) : null
      const ownedBy = owner && owner.rosterId !== m.rosterId ? owner.displayName : null
      const pick = byOverall.get(overall)
      const keeper = keeperAt.get(overall)
      const detail = (p: { position: string; team: string | null }) => [p.position, p.team].filter(Boolean).join(' · ') || null
      if (pick) {
        picksMade++
        const skipped = EMPTY_PLAYER.test(pick.playerName.trim())
        return { label: cell?.label ?? '', overall, kind: 'pick' as const, player: skipped ? 'Skipped' : pick.playerName, detail: skipped ? null : detail(pick), ownedBy }
      }
      if (keeper) {
        keepers++
        return { label: cell?.label ?? '', overall, kind: 'keeper' as const, player: keeper.playerName, detail: detail(keeper), ownedBy }
      }
      return { label: cell?.label ?? '', overall, kind: 'open' as const, player: null, detail: null, ownedBy }
    }),
  }))
  return { managers, rows, picksMade, keepers }
}
