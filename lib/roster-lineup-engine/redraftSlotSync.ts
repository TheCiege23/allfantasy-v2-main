import type { Prisma } from '@prisma/client'

import { redraftSlotChanges } from '@/lib/league-runtime/redraftSlotType'

/**
 * Keep `RedraftRosterPlayer.slotType` in step with a saved NATIVE lineup.
 *
 * 🛑 THE BUG THIS CLOSES. Native scoring decides who scores from `slotType` —
 * `scoreRosterStarters` live and `finalizeRedraftWeek` at the seal, both through
 * `countsTowardScore`. The lineup engine wrote `Roster.playerData` and
 * `af_roster_lineup_assignments` and never touched `slotType`; the materializer only CREATES
 * rows, and the one writer for existing rows (`PATCH /api/redraft/roster`) has no UI caller. So a
 * native manager could bench an OUT player, see "Lineup saved", and still be scored on him.
 *
 * Runs inside `persistRosterLineupWithEngine`'s transaction, so the lineup and the scoring
 * projection commit together or not at all. The caller gates it to NATIVE leagues with a linked
 * `RedraftRoster`; an imported league is a SHADOW twin and must never reach redraft tables.
 *
 * Compares slot CATEGORY (starter/bench/ir/taxi/devy), so a starter already stored as `FLEX`
 * stays `FLEX` — only a real move is written.
 */
export async function syncRedraftSlotTypesForLineup(
  tx: Prisma.TransactionClient,
  input: { redraftRosterId: string; playerData: unknown },
): Promise<{ updated: number }> {
  const rows = await tx.redraftRosterPlayer.findMany({
    where: { rosterId: input.redraftRosterId, droppedAt: null },
    select: { id: true, playerId: true, position: true, slotType: true },
  })
  const changes = redraftSlotChanges(input.playerData, rows)
  if (changes.length === 0) return { updated: 0 }

  const byTarget = new Map<string, string[]>()
  for (const c of changes) byTarget.set(c.to, [...(byTarget.get(c.to) ?? []), c.id])
  for (const [slotType, ids] of byTarget) {
    await tx.redraftRosterPlayer.updateMany({ where: { id: { in: ids } }, data: { slotType } })
  }
  return { updated: changes.length }
}
