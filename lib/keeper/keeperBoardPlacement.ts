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
 *   traded pick   a round whose pick this team traded away is not the team's to fill. A pick the
 *                 team ACQUIRED counts as its own: in the cost round it takes that pick ("placed on
 *                 pick acquired from …"); otherwise the keeper moves in the same direction to the
 *                 nearest round the team holds any pick in, then the other direction, and the board
 *                 says so (`placementNote`). Two picks in one round (own + acquired) hold two keepers.
 *   no pick left  the keeper is FLAGGED for the commissioner — never silently dropped.
 *
 * 🛑 WHY "THE TEAM'S OWN PICK" MATTERS: `buildKeeperLocks` resolves a lock's owner through
 * `resolvePickOwner`, so a keeper placed in a round whose pick was traded becomes a lock FOR THE
 * OTHER TEAM and is auto-drafted onto their roster. Placing only into owned rounds is what stops that.
 */

import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { KeeperSelection } from '@/lib/live-draft-engine/keeper/types'
import type { SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import { roundLabel, type KeeperRules } from './keeperRules'

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

/** Picks a team already fills by hand (a commissioner override), as `pickKey` — never taken by an auto keeper. */
type ReservedPicks = ReadonlyMap<string, ReadonlySet<string>>

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

/** One pick a team holds: its own, or one it acquired (`from` = the team whose pick it was). */
export type OwnedPick = { round: number; slot: number; own: boolean; from: string | null }

/** `round:slot` — how a pick is named in `reserved`. */
export const pickKey = (round: number, slot: number) => `${round}:${slot}`

/**
 * Every pick this team holds, own AND acquired, per `resolvePickOwner` (the latest trade of a pick
 * wins, exactly as the board resolves it). Own first within a round, then by slot.
 */
export function ownedPicks(rosterId: string, shape: KeeperBoardShape): OwnedPick[] {
  const out: OwnedPick[] = []
  for (let r = 1; r <= Math.max(1, shape.rounds); r++) {
    for (const entry of shape.slotOrder) {
      const owner = resolvePickOwner(r, entry.slot, shape.slotOrder, shape.tradedPicks)
      if (owner?.rosterId !== rosterId) continue
      const own = entry.rosterId === rosterId
      out.push({ round: r, slot: entry.slot, own, from: own ? null : entry.displayName || 'another team' })
    }
  }
  return out.sort((a, b) => a.round - b.round || Number(b.own) - Number(a.own) || a.slot - b.slot)
}

export function placeKeepersOnBoard(
  rules: KeeperRules,
  keepers: readonly KeeperForBoard[],
  shape: KeeperBoardShape,
  /** Picks a team already fills by hand, as `pickKey(round, slot)`. */
  reserved: ReservedPicks = new Map(),
): KeeperBoardPlacement {
  const rounds = Math.max(1, shape.rounds)
  const direction = keeperBoardDirection(rules)
  const step = direction === 'later' ? 1 : -1

  const byTeam = new Map<string, KeeperForBoard[]>()
  for (const k of keepers) byTeam.set(k.rosterId, [...(byTeam.get(k.rosterId) ?? []), k])

  const selections: BoardKeeperSelection[] = []
  const flagged: FlaggedKeeper[] = []
  for (const [rosterId, list] of byTeam) {
    const held = reserved.get(rosterId) ?? new Set<string>()
    const seated = shape.slotOrder.some((e) => e.rosterId === rosterId)
    const picks = seated ? ownedPicks(rosterId, { ...shape, rounds }).filter((p) => !held.has(pickKey(p.round, p.slot))) : []
    const used = new Set<string>()
    const freeIn = (round: number) => picks.find((p) => p.round === round && !used.has(pickKey(p.round, p.slot))) ?? null
    const ownedRound = (round: number) => picks.some((p) => p.round === round)

    // Cheapest-pick-last, as ./keeperRules placeTeamKeepers: walking earlier, the earliest cost goes
    // first; walking later, the latest. Ties keep the order given.
    const order = list.map((k, i) => ({ k, i })).sort((a, b) =>
      (step === -1 ? a.k.costRound - b.k.costRound : b.k.costRound - a.k.costRound) || a.i - b.i)

    for (const { k } of order) {
      const want = Math.min(Math.max(1, k.costRound), rounds)
      let pick = freeIn(want)
      // The rule's direction first, then the other way.
      for (let r = want + step; !pick && r >= 1 && r <= rounds; r += step) pick = freeIn(r)
      for (let r = want - step; !pick && r >= 1 && r <= rounds; r -= step) pick = freeIn(r)
      if (!pick) {
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
      used.add(pickKey(pick.round, pick.slot))
      const acquired = pick.own ? null : `pick acquired from ${pick.from}`
      let note: string | undefined
      if (pick.round === want) {
        if (acquired) note = `${roundLabel(pick.round)} (placed on ${acquired})`
      } else {
        const why = ownedRound(want)
          ? `two keepers cost ${roundLabel(k.costRound)}`
          : `${roundLabel(k.costRound)} pick was traded`
        note = `${roundLabel(pick.round)} (moved from ${roundLabel(k.costRound)}: ${why}${acquired ? `; ${acquired}` : ''})`
      }
      selections.push({
        rosterId,
        roundCost: pick.round,
        playerName: k.playerName,
        position: k.position,
        team: k.team,
        playerId: k.playerId,
        costRound: k.costRound,
        autoPlaced: true,
        ...(pick.own ? {} : { pickSlot: pick.slot }),
        ...(note ? { placementNote: note } : {}),
      })
    }
  }
  selections.sort((a, b) => a.roundCost - b.roundCost || a.rosterId.localeCompare(b.rosterId))
  return { selections, flagged }
}
