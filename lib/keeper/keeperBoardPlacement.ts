/**
 * Locked keepers → picks on the draft board, from the league's own keeper rules. PURE. No prisma.
 *
 * The commissioner does not assign each keeper to a pick by hand: every locked keeper takes his
 * team's OWN pick in the round he costs (`KeeperRecord.costRound`, already priced by
 * ./keeperRules `keeperCostRound` under the league's rule). Snake / linear / 3RR is the board's
 * business — `buildKeeperLocks` turns (team, round) into the actual slot and overall pick.
 *
 *   same round    two keepers on one team costing one round: the later one moves to the team's
 *                 next EARLIER open round (default), or the next LATER one when the league's
 *                 same-round rule is `lose_round_after`. On the board a keeper is already locked,
 *                 so the refusing rules (`player_chooses` / `reject_both`) never drop one here —
 *                 they were applied when the manager saved (./selectionEngine).
 *   traded pick   a round whose pick this team traded away is not the team's to fill: the keeper
 *                 moves in the same direction to the nearest round the team still owns, then the
 *                 other direction, and the board says so (`placementNote`).
 *   no pick left  the keeper is FLAGGED for the commissioner — never silently dropped.
 *
 * 🛑 WHY "THE TEAM'S OWN PICK" MATTERS: `buildKeeperLocks` resolves a lock's owner through
 * `resolvePickOwner`, so a keeper placed in a round whose pick was traded becomes a lock FOR THE
 * OTHER TEAM and is auto-drafted onto their roster. Placing only into owned rounds is what stops that.
 */

import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { KeeperSelection } from '@/lib/live-draft-engine/keeper/types'
import type { SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import { placeTeamKeepers, placedKeeperLabel, roundLabel, type KeeperRules } from './keeperRules'

export type KeeperForBoard = {
  rosterId: string
  playerId: string | null
  playerName: string
  position: string
  team: string | null
  /** The round his keeper cost lands in (`KeeperRecord.costRound`). */
  costRound: number
}

export type KeeperBoardShape = {
  slotOrder: SlotOrderEntry[]
  tradedPicks: TradedPickRecord[]
  rounds: number
}

/** Rounds a team already fills by hand (a commissioner override) — never taken by an auto keeper. */
type ReservedRounds = ReadonlyMap<string, ReadonlySet<number>>

export type BoardKeeperSelection = KeeperSelection & {
  /** Set when the keeper does not sit in the round he costs, and why ("Round 4 (moved from Round 5: …)"). */
  placementNote?: string
  /** The round he cost before any move. */
  costRound?: number
  autoPlaced?: true
}

export type FlaggedKeeper = {
  rosterId: string
  playerId: string | null
  playerName: string
  costRound: number
  reason: 'no_pick_available'
  message: string
}

type KeeperBoardPlacement = {
  selections: BoardKeeperSelection[]
  flagged: FlaggedKeeper[]
}

/** Which way a clashing keeper walks on the board. */
export function keeperBoardDirection(rules: Pick<KeeperRules, 'sameRoundRule'>): 'earlier' | 'later' {
  return rules.sameRoundRule === 'lose_round_after' ? 'later' : 'earlier'
}

/** Rounds in which this team still holds its OWN pick (not traded away). */
export function ownedOwnRounds(rosterId: string, shape: KeeperBoardShape): number[] {
  const entry = shape.slotOrder.find((e) => e.rosterId === rosterId)
  if (!entry) return []
  const out: number[] = []
  for (let r = 1; r <= Math.max(1, shape.rounds); r++) {
    const owner = resolvePickOwner(r, entry.slot, shape.slotOrder, shape.tradedPicks)
    if (owner?.rosterId === rosterId) out.push(r)
  }
  return out
}

export function placeKeepersOnBoard(
  rules: KeeperRules,
  keepers: readonly KeeperForBoard[],
  shape: KeeperBoardShape,
  reserved: ReservedRounds = new Map(),
): KeeperBoardPlacement {
  const rounds = Math.max(1, shape.rounds)
  const direction = keeperBoardDirection(rules)
  const boardRules: KeeperRules = { ...rules, sameRoundRule: direction === 'later' ? 'lose_round_after' : 'lose_round_before' }

  const byTeam = new Map<string, { k: KeeperForBoard; key: string }[]>()
  keepers.forEach((k, i) => {
    const list = byTeam.get(k.rosterId) ?? []
    list.push({ k, key: `k${i}` })
    byTeam.set(k.rosterId, list)
  })

  const selections: BoardKeeperSelection[] = []
  const flagged: FlaggedKeeper[] = []
  for (const [rosterId, list] of byTeam) {
    const held = reserved.get(rosterId) ?? new Set<number>()
    const seated = shape.slotOrder.some((e) => e.rosterId === rosterId)
    const owned = seated ? ownedOwnRounds(rosterId, { ...shape, rounds }).filter((r) => !held.has(r)) : []
    const placement = placeTeamKeepers(
      boardRules,
      list.map(({ k, key }) => ({ playerId: key, costRound: k.costRound })),
      { totalRounds: rounds, ownedRounds: owned },
    )
    const byKey = new Map(list.map((x) => [x.key, x.k]))
    const used = new Set(placement.placed.map((p) => p.round))
    const toSelection = (k: KeeperForBoard, round: number, note: string | undefined): BoardKeeperSelection => ({
      rosterId,
      roundCost: round,
      playerName: k.playerName,
      position: k.position,
      team: k.team,
      playerId: k.playerId,
      costRound: k.costRound,
      autoPlaced: true,
      ...(note ? { placementNote: note } : {}),
    })
    for (const p of placement.placed) {
      const k = byKey.get(p.playerId)!
      selections.push(toSelection(k, p.round, p.round !== p.costRound ? placedKeeperLabel(p) : undefined))
    }
    // Nothing left in the rule's direction: the nearest open owned round the OTHER way, else flag.
    for (const r of placement.refused) {
      const k = byKey.get(r.playerId)!
      const want = Math.min(Math.max(1, k.costRound), rounds)
      const step = direction === 'later' ? -1 : 1
      let round: number | null = null
      for (let x = want + step; x >= 1 && x <= rounds; x += step) {
        if (owned.includes(x) && !used.has(x)) { round = x; break }
      }
      if (round == null) {
        flagged.push({
          rosterId,
          playerId: k.playerId,
          playerName: k.playerName,
          costRound: k.costRound,
          reason: 'no_pick_available',
          message: seated
            ? `${k.playerName} costs ${roundLabel(k.costRound)}, and his team has no pick left to keep him with. The commissioner needs to place him.`
            : `${k.playerName}'s team is not seated on this draft board yet. The commissioner needs to place him.`,
        })
        continue
      }
      used.add(round)
      const why = owned.includes(want) ? `the rounds ${direction === 'later' ? 'after' : 'before'} it were full` : `${roundLabel(k.costRound)} pick was traded`
      selections.push(toSelection(k, round, `${roundLabel(round)} (moved from ${roundLabel(k.costRound)}: ${why})`))
    }
  }
  selections.sort((a, b) => a.roundCost - b.roundCost || a.rosterId.localeCompare(b.rosterId))
  return { selections, flagged }
}
