/**
 * The IR / IL count a roster layout gives, and keeping `League.irSlots` on it (2026-11-15).
 *
 * Lineups are checked against the saved slot map (lib/redraft/rosterConfigResolver.ts), which carries IR / IL as a
 * slot. `League.irSlots` is a separate column read by trade context, league summaries and the AI. The settings
 * window used to change only the column and the roster editor only the map, so the two drifted. The roster editor
 * now writes both.
 */
import { prisma } from '@/lib/prisma'
import { isInjuredReserveRosterSlot } from '@/lib/redraft/rosterConfigResolver'

/** Total IR / IL / reserve seats in a slot map (taxi and devy are not injured reserve). */
export function injuredReserveSlotCount(slots: Record<string, unknown>): number {
  let total = 0
  for (const [key, raw] of Object.entries(slots ?? {})) {
    const n = Math.floor(Number(raw))
    if (Number.isFinite(n) && n > 0 && isInjuredReserveRosterSlot(key)) total += n
  }
  return total
}

/** Never throws: the roster save it follows has already succeeded. */
export async function syncLeagueIrSlotsColumn(leagueId: string, slots: Record<string, unknown>): Promise<void> {
  const irSlots = injuredReserveSlotCount(slots)
  try {
    await prisma.league.update({ where: { id: leagueId }, data: { irSlots } })
  } catch {
    // The column is a summary; lineups read the slot map, which is already saved.
  }
}
