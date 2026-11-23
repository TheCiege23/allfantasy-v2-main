/**
 * Apply `starterSlotLabelChanges` to stored season rosters (./starterSlotLabels.ts).
 *
 * Only starter LABELS are rewritten — never who starts — so scoring and game locks are untouched. Called by
 * the draft finalizer (which also re-runs on roster and draft-room views, so a season drafted before this
 * existed heals the next time anyone opens it) and by the native lineup sync after a save.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { starterSlotLabelChanges } from '@/lib/redraft/starterSlotLabels'

type Db = Pick<PrismaClient, 'redraftRosterPlayer'> | Prisma.TransactionClient

/** Relabel one season roster's starters to fit the league's layout. Returns how many rows changed. */
export async function relabelRosterStarters(
  db: Db,
  args: { redraftRosterId: string; sport: string; leagueSettings: unknown },
): Promise<number> {
  const rows = await db.redraftRosterPlayer.findMany({
    where: { rosterId: args.redraftRosterId, droppedAt: null },
    select: { id: true, position: true, slotType: true },
  })
  const { starterCapacities } = resolveRedraftRosterConfig(args.sport, args.leagueSettings)
  const changes = starterSlotLabelChanges(args.sport, rows, starterCapacities)
  for (const [id, slotType] of changes) {
    // Guarded on the label read, so a concurrent move is not overwritten with a stale relabel.
    const before = rows.find((r) => r.id === id)?.slotType
    await db.redraftRosterPlayer.updateMany({ where: { id, droppedAt: null, slotType: before }, data: { slotType } })
  }
  return changes.size
}

/** Every roster in a season. Never throws: a label is cosmetic to scoring and must not fail a caller. */
export async function relabelSeasonStarters(
  db: Pick<PrismaClient, 'redraftRosterPlayer' | 'redraftRoster'>,
  args: { seasonId: string; sport: string; leagueSettings: unknown },
): Promise<{ rosters: number; relabelled: number }> {
  const rosters = await db.redraftRoster.findMany({ where: { seasonId: args.seasonId }, select: { id: true } })
  let relabelled = 0
  for (const r of rosters) {
    relabelled += await relabelRosterStarters(db, { redraftRosterId: r.id, sport: args.sport, leagueSettings: args.leagueSettings }).catch(() => 0)
  }
  return { rosters: rosters.length, relabelled }
}
