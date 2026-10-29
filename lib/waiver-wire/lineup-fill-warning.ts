/**
 * The "your lineup can no longer be filled" warning on a drop or a claim with a drop.
 *
 * A WARNING, NOT A BLOCK. Dropping your only catcher is a legal move — maybe you are about to pick
 * one up — so the add/drop and claim routes refuse it once with `LINEUP_WARNING`, the screens ask
 * the manager to confirm, and the confirmed retry (`confirmLineupWarning: true`) goes through.
 *
 * It fires only when the move makes things WORSE: fewer starting slots fillable afterwards than
 * before, and not all of them. A roster that was already short a slot is not nagged on every move
 * that leaves it exactly as short.
 *
 * Fillable is a maximum matching of active players (IR / taxi / devy are out, the same reserve rule
 * as the roster limit) to the league's starting slots, with each slot's eligibility from the same
 * table lineup validation reads (`allowedPositionsForSlot`). A greedy fill can strand a slot a
 * different assignment fills — a flex taking the only TE — so this does not use one.
 *
 * ⚠ A PLAYER WITH NO POSITION ON FILE MEANS "COULD NOT VERIFY", and no warning is raised: guessing
 * him ineligible would warn on a lineup that is fine.
 */
import { prisma } from '@/lib/prisma'
import { allowedPositionsForSlot, normalizeToken } from '@/lib/redraft/lineupValidation'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { reservePlayerIds } from '@/lib/league/rosterLimit'
import { addPlayerToRosterData, getRosterPlayerIds, removePlayerFromRosterData } from './roster-utils'

export const LINEUP_WARNING_CODE = 'LINEUP_WARNING' as const
export const LINEUP_WARNING_STARTERS_UNFILLABLE = 'STARTERS_UNFILLABLE' as const

export type LineupFillWarning = {
  code: typeof LINEUP_WARNING_STARTERS_UNFILLABLE
  /** Starting slots (normalized tokens, e.g. `C`, `QB`, `FLX`) nobody could fill after the move. */
  unfilledSlots: string[]
  message: string
}

/** A player's positions as lineup tokens. Dual eligibility arrives as one string ("G-F", "SS,2B"). */
export function positionTokens(raw: string | null | undefined): string[] {
  if (!raw) return []
  return [...new Set(String(raw).split(/[-/,|]+/).map((p) => normalizeToken(p)).filter(Boolean))]
}

/**
 * Pure: how many starting slots these players can fill at once, and which are left empty.
 * Kuhn's augmenting paths; slots are tried most-restrictive first so the names left over are the
 * ones a manager would recognise (the `C`, not the `UTIL`).
 */
export function startingSlotFill(args: {
  sport: string
  starterCapacities: ReadonlyMap<string, number>
  players: ReadonlyArray<{ id: string; positions: readonly string[] }>
}): { slots: number; filled: number; unfilledSlots: string[] } {
  const instances: Array<{ slot: string; accepts: Set<string> }> = []
  for (const [slot, count] of args.starterCapacities) {
    const accepts = new Set(allowedPositionsForSlot(args.sport, slot).map((p) => normalizeToken(p)))
    for (let i = 0; i < count; i += 1) instances.push({ slot, accepts })
  }
  const eligible = (slot: { accepts: Set<string> }, p: { positions: readonly string[] }) =>
    p.positions.some((pos) => slot.accepts.has(pos))
  const breadth = (slot: { accepts: Set<string> }) => args.players.filter((p) => eligible(slot, p)).length
  const order = instances.map((_, i) => i).sort((a, b) => breadth(instances[a]!) - breadth(instances[b]!))

  const slotOfPlayer = new Map<number, number>()
  const tryAssign = (slotIdx: number, seen: Set<number>): boolean => {
    for (let p = 0; p < args.players.length; p += 1) {
      if (seen.has(p) || !eligible(instances[slotIdx]!, args.players[p]!)) continue
      seen.add(p)
      const holder = slotOfPlayer.get(p)
      if (holder === undefined || tryAssign(holder, seen)) {
        slotOfPlayer.set(p, slotIdx)
        return true
      }
    }
    return false
  }
  const unfilledSlots: string[] = []
  let filled = 0
  for (const idx of order) {
    if (tryAssign(idx, new Set())) filled += 1
    else unfilledSlots.push(instances[idx]!.slot)
  }
  return { slots: instances.length, filled, unfilledSlots }
}

export function lineupWarningMessage(unfilledSlots: readonly string[]): string {
  const names = [...new Set(unfilledSlots)].join(', ')
  return `After this move your lineup cannot fill every starting slot (${names}). Confirm to go ahead anyway.`
}

/**
 * Pure: the warning for a move, or null. `before` and `after` are the active players before and
 * after it, each with positions.
 */
export function lineupFillWarningForMove(args: {
  sport: string
  starterCapacities: ReadonlyMap<string, number>
  before: ReadonlyArray<{ id: string; positions: readonly string[] }>
  after: ReadonlyArray<{ id: string; positions: readonly string[] }>
}): LineupFillWarning | null {
  if (args.starterCapacities.size === 0) return null
  const before = startingSlotFill({ sport: args.sport, starterCapacities: args.starterCapacities, players: args.before })
  const after = startingSlotFill({ sport: args.sport, starterCapacities: args.starterCapacities, players: args.after })
  if (after.filled >= after.slots || after.filled >= before.filled) return null
  return {
    code: LINEUP_WARNING_STARTERS_UNFILLABLE,
    unfilledSlots: after.unfilledSlots,
    message: lineupWarningMessage(after.unfilledSlots),
  }
}

/**
 * The warning for dropping `dropPlayerId` (and adding `addPlayerId`, when it is an add/drop or a
 * claim) from one roster, read from the database. Null when there is no drop, nothing gets worse,
 * or the lineup cannot be verified. Never throws: a failed read is no warning, since this is advice
 * and every block the move needs is enforced elsewhere.
 */
export async function loadLineupFillWarning(input: {
  leagueId: string
  rosterId: string
  addPlayerId?: string | null
  dropPlayerId?: string | null
}): Promise<LineupFillWarning | null> {
  const dropId = input.dropPlayerId ? String(input.dropPlayerId).trim() : ''
  if (!dropId) return null
  try {
    const [league, roster] = await Promise.all([
      prisma.league.findUnique({ where: { id: input.leagueId }, select: { sport: true, settings: true } }),
      prisma.roster.findFirst({ where: { id: input.rosterId, leagueId: input.leagueId }, select: { playerData: true } }),
    ])
    if (!league || !roster) return null
    const sport = String(league.sport ?? 'NFL')
    const config = resolveRedraftRosterConfig(sport, league.settings ?? null)

    const addId = input.addPlayerId ? String(input.addPlayerId).trim() : ''
    let projected: unknown = removePlayerFromRosterData(roster.playerData, dropId)
    if (addId) projected = addPlayerToRosterData(projected, addId)
    const reserve = reservePlayerIds(roster.playerData)
    const active = (data: unknown) => getRosterPlayerIds(data).filter((id) => !reserve.has(id))
    const beforeIds = active(roster.playerData)
    const afterIds = active(projected)

    const ids = [...new Set([...beforeIds, ...afterIds])]
    const rows = await prisma.sportsPlayer.findMany({ where: { id: { in: ids } }, select: { id: true, position: true } })
    const positions = new Map(rows.map((r) => [r.id, positionTokens(r.position)]))
    if (ids.some((id) => (positions.get(id)?.length ?? 0) === 0)) return null
    const withPositions = (list: string[]) => list.map((id) => ({ id, positions: positions.get(id)! }))

    return lineupFillWarningForMove({
      sport,
      starterCapacities: config.starterCapacities,
      before: withPositions(beforeIds),
      after: withPositions(afterIds),
    })
  } catch {
    return null
  }
}

/** True when the request body confirms the manager saw the lineup warning. */
export function lineupWarningConfirmed(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return b.confirmLineupWarning === true || b.confirm_lineup_warning === true
}
