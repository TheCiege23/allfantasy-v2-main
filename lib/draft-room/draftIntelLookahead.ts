/**
 * Draft intel lookahead — "before your next pick": every pick other managers
 * make between now and the viewer's next turn, with each manager's tendency in
 * this draft, the positions they still need, and a projected pick.
 *
 * Pure logic only — no Prisma, no fetch, no React.
 *
 * The projection is a simple, explainable heuristic, not a model: walk the
 * window in order, and each manager takes the first of the next few
 * players by MARKET ADP that fills a need, else the best ADP. Players with no
 * market ADP are never projected (same honesty rule as draftPulse).
 */

import { getSlotInRoundForOverall, formatPickLabel } from '@/lib/live-draft-engine/DraftOrderService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { DraftType, SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import {
  classifyManagerTendency,
  isFilledPick,
  type AdpLookup,
  type ManagerTendency,
  type PulsePick,
  type PulsePoolPlayer,
} from './draftPulse'

export type LookaheadInput = {
  picks: readonly PulsePick[]
  /** Players still on the board. */
  available: readonly PulsePoolPlayer[]
  lookup: AdpLookup
  slotOrder: readonly SlotOrderEntry[]
  tradedPicks?: readonly TradedPickRecord[]
  teamCount: number
  rounds: number
  draftType: DraftType
  thirdRoundReversal: boolean
  /** Overall pick on the clock (1-based). */
  currentOverall: number
  viewerRosterId: string | null
  /** League starter slots (e.g. `{ PG: 1, SG: 1, G: 1, UTIL: 2 }`); flex keys are ignored. */
  starterSlots?: Record<string, number> | null
  /** Rosters drafted by the computer (orphan / AI-managed). */
  autoRosterIds?: ReadonlySet<string>
  /** Window cap when the viewer has no upcoming pick (spectator) and for very long turns. */
  maxRows?: number
  /** How many ADP-ranked players a manager weighs for need. */
  candidatesPerPick?: number
}

export type LookaheadRow = {
  overall: number
  pickLabel: string
  rosterId: string
  displayName: string
  tendency: ManagerTendency
  isAuto: boolean
  /** Positions this manager has not yet filled, in pool-relevance order. */
  needs: string[]
  projected: { name: string; position: string; adp: number } | null
}

export type LookaheadResult = {
  /** First overall in the window (after any picks the viewer makes back-to-back). */
  startOverall: number
  /** The viewer's next pick after the window; null for a spectator or when they have none left. */
  viewerNextOverall: number | null
  /** Total picks in the window (rows may be capped). */
  windowSize: number
  rows: LookaheadRow[]
}

function normPos(pos: string | null | undefined): string {
  return String(pos ?? '').trim().toUpperCase()
}

function ownerFor(input: LookaheadInput, overall: number): { rosterId: string; displayName: string } | null {
  const round = Math.ceil(overall / input.teamCount)
  const slot = getSlotInRoundForOverall({
    overall,
    teamCount: input.teamCount,
    draftType: input.draftType,
    thirdRoundReversal: input.thirdRoundReversal,
  })
  const owner = resolvePickOwner(round, slot, [...input.slotOrder], [...(input.tradedPicks ?? [])])
  return owner ? { rosterId: owner.rosterId, displayName: owner.displayName } : null
}

/**
 * The positions that count as "needs". Starter-slot keys that are real player
 * positions in this pool (flex buckets like FLEX / UTIL / G / F drop out because
 * no player carries them); without starter slots, every position that appears
 * among ADP-ranked players. Ordered by first appearance in ADP.
 */
function needUniverse(available: readonly PulsePoolPlayer[], starterSlots: Record<string, number> | null | undefined): string[] {
  const byAdp = available
    .filter((p) => typeof p.adp === 'number' && Number.isFinite(p.adp) && p.adp > 0)
    .sort((a, b) => (a.adp as number) - (b.adp as number))
  const ordered: string[] = []
  for (const p of byAdp) {
    const pos = normPos(p.position)
    if (pos && !ordered.includes(pos)) ordered.push(pos)
  }
  if (!starterSlots) return ordered
  const slotKeys = new Set(
    Object.entries(starterSlots)
      .filter(([, n]) => Number(n) > 0)
      .map(([k]) => normPos(k)),
  )
  return ordered.filter((pos) => slotKeys.has(pos))
}

export function buildDraftLookahead(input: LookaheadInput): LookaheadResult {
  const total = Math.max(0, input.teamCount * input.rounds)
  const maxRows = input.maxRows ?? 16
  const k = Math.max(1, input.candidatesPerPick ?? 4)
  const viewer = input.viewerRosterId ?? null

  // Skip any picks the viewer makes right now (their own turn, incl. back-to-back at the turn).
  let start = Math.max(1, input.currentOverall)
  while (viewer && start <= total && ownerFor(input, start)?.rosterId === viewer) start += 1

  let end = start
  let viewerNextOverall: number | null = null
  while (end <= total) {
    if (viewer && ownerFor(input, end)?.rosterId === viewer) {
      viewerNextOverall = end
      break
    }
    if (!viewer && end - start >= maxRows) break
    end += 1
  }
  const windowSize = Math.max(0, end - start)

  const universe = needUniverse(input.available, input.starterSlots)
  const filled = input.picks.filter(isFilledPick)
  const haveByRoster = new Map<string, Set<string>>()
  for (const p of filled) {
    const set = haveByRoster.get(p.rosterId) ?? new Set<string>()
    set.add(normPos(p.position))
    haveByRoster.set(p.rosterId, set)
  }

  const pool = input.available
    .filter((p) => typeof p.adp === 'number' && Number.isFinite(p.adp) && (p.adp as number) > 0)
    .sort((a, b) => (a.adp as number) - (b.adp as number))
  const taken = new Set<PulsePoolPlayer>()

  const rows: LookaheadRow[] = []
  for (let overall = start; overall < end && rows.length < maxRows; overall += 1) {
    const owner = ownerFor(input, overall)
    if (!owner) continue
    const have = haveByRoster.get(owner.rosterId) ?? new Set<string>()
    const needs = universe.filter((pos) => !have.has(pos))

    const candidates: PulsePoolPlayer[] = []
    for (const p of pool) {
      if (taken.has(p)) continue
      candidates.push(p)
      if (candidates.length >= k) break
    }
    const choice = candidates.find((p) => needs.includes(normPos(p.position))) ?? candidates[0] ?? null
    if (choice) {
      taken.add(choice)
      have.add(normPos(choice.position))
      haveByRoster.set(owner.rosterId, have)
    }

    rows.push({
      overall,
      pickLabel: formatPickLabel(overall, input.teamCount),
      rosterId: owner.rosterId,
      displayName: owner.displayName,
      tendency: classifyManagerTendency(filled, owner.rosterId, input.lookup),
      isAuto: Boolean(input.autoRosterIds?.has(owner.rosterId)),
      needs,
      projected: choice ? { name: choice.name, position: normPos(choice.position), adp: choice.adp as number } : null,
    })
  }

  return { startOverall: start, viewerNextOverall, windowSize, rows }
}
