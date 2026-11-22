import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * 🛑 A KEEPER WINDOW LIVES ON THE INCOMING SEASON, AND THE INCOMING SEASON'S ROSTERS START EMPTY.
 *
 * Closing a keeper season clones empty roster shells for next year and opens the window there
 * (triggerKeeperOffseason). The Keepers tab, the lock, the carryover and the next draft all use that
 * incoming season and its roster ids. But the players a manager can keep — and the eligibility rows
 * that price them — sit on the same owner's roster in the season just played.
 *
 * Reading eligibility or roster players by the incoming ids found nothing, so every manager saw an
 * empty roster and every keeper was refused as `ineligible` (keeper simulation, 2026-11-10: 27 of 27
 * leagues, 0 keepers carried). This maps an incoming (season, roster) to the owner's roster in the
 * season before it. Ids that are not the incoming season of a keeper window come back unchanged, so a
 * caller already holding the season-just-played ids keeps working.
 */
export async function resolveKeeperSourceRoster(
  input: { leagueId: string; seasonId: string; rosterId?: string | null },
  db: Db = prisma,
): Promise<{ seasonId: string; rosterId: string | null; mapped: boolean }> {
  const unchanged = { seasonId: input.seasonId, rosterId: input.rosterId ?? null, mapped: false }
  const windowSession = await db.keeperSelectionSession.findFirst({
    where: { leagueId: input.leagueId, seasonId: input.seasonId },
    select: { id: true },
  })
  if (!windowSession) return unchanged

  const incoming = await db.redraftSeason.findFirst({
    where: { id: input.seasonId, leagueId: input.leagueId },
    select: { season: true, createdAt: true },
  })
  if (!incoming) return unchanged
  const previous = await db.redraftSeason.findFirst({
    where: { leagueId: input.leagueId, NOT: { id: input.seasonId }, season: { lt: incoming.season } },
    orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  })
  if (!previous) return unchanged
  if (!input.rosterId) return { seasonId: previous.id, rosterId: null, mapped: true }

  const shell = await db.redraftRoster.findFirst({
    where: { id: input.rosterId, leagueId: input.leagueId, seasonId: input.seasonId },
    select: { ownerId: true },
  })
  if (!shell) return unchanged
  const source = await db.redraftRoster.findFirst({
    where: { leagueId: input.leagueId, seasonId: previous.id, ownerId: shell.ownerId },
    select: { id: true },
  })
  // No roster last season (a manager who joined for the new year): nothing to keep, never someone else's.
  return { seasonId: previous.id, rosterId: source?.id ?? null, mapped: true }
}
