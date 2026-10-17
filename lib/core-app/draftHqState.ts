import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'

export function draftOrder(raw: unknown): SlotOrderEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const slot = Number(entry.slot)
    if (!Number.isInteger(slot) || slot < 1 || entry.rosterId == null) return []
    return [{ slot, rosterId: String(entry.rosterId), displayName: String(entry.displayName ?? '') }]
  })
}

export function draftTrades(raw: unknown): TradedPickRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.round) || entry.round < 1 ||
        entry.originalRosterId == null || entry.newRosterId == null) return []
    return [{ ...entry, originalRosterId: String(entry.originalRosterId), newRosterId: String(entry.newRosterId),
      previousOwnerName: String(entry.previousOwnerName ?? ''), newOwnerName: String(entry.newOwnerName ?? '') }]
  })
}

export function draftPickOwner(args: {
  overall: number; teamCount: number; draftType: string; thirdRoundReversal?: boolean;
  slotOrder: unknown; tradedPicks?: unknown;
}) {
  if (!Number.isInteger(args.overall) || args.overall < 1 || args.teamCount < 1 ||
      !['snake', 'linear'].includes(args.draftType.toLowerCase())) return null
  const slot = getSlotInRoundForOverall({ overall: args.overall, teamCount: args.teamCount,
    draftType: args.draftType.toLowerCase() as 'snake' | 'linear', thirdRoundReversal: args.thirdRoundReversal ?? false })
  const order = draftOrder(args.slotOrder)
  const original = order.find((entry) => entry.slot === slot)
  const owner = resolvePickOwner(Math.ceil(args.overall / args.teamCount), slot, order, draftTrades(args.tradedPicks))
  return original && owner ? { ...owner, slot, originalRosterId: original.rosterId, originalName: original.displayName } : null
}

/** A keeper or edited pick can leave gaps; only the stored cursor defines the next turn. */
export function draftNextPick(status: string, nextOverall: number, totalPicks: number): number | null {
  if (['completed', 'complete', 'post_draft'].includes(status.toLowerCase())) return null
  return Number.isInteger(nextOverall) && nextOverall > 0 && nextOverall <= totalPicks ? nextOverall : null
}

/** Current-only portfolio matches the league route until explicit archive selection ships. */
export function latestDraftsByLeague<T extends { leagueId: string; id: string; createdAt: Date }>(sessions: T[]): T[] {
  const latest = new Map<string, T>()
  for (const session of sessions) {
    const previous = latest.get(session.leagueId)
    if (!previous || session.createdAt.getTime() > previous.createdAt.getTime() ||
        (session.createdAt.getTime() === previous.createdAt.getTime() && session.id > previous.id)) latest.set(session.leagueId, session)
  }
  return [...latest.values()]
}
