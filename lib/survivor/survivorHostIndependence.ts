/**
 * Is there a human host who may break a secret tie without being a player in it?
 *
 * A commissioner who PLAYS is a manager for every hidden outcome (see survivorAccessControl.ts), so
 * a council that waits for "an independent commissioner" waits forever in their league. The tally
 * asks this before it chooses between a commissioner decision and the stones.
 *
 * Owner only, on purpose: a co-commissioner host can also resolve a tie through the foundation
 * route, but the tally must not depend on who happens to hold that role mid-season.
 */

import type { Prisma, PrismaClient } from '@prisma/client'

import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'

type Db = Prisma.TransactionClient | PrismaClient

export async function hasIndependentSurvivorHost(leagueId: string, db: Db): Promise<boolean> {
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true } })
  if (!league?.userId) return false
  const settings = normalizeSurvivorFoundationSettings(
    league.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {},
  )
  if (settings.commissionerParticipationMode !== 'non_participating_host') return false
  const [player, roster] = await Promise.all([
    db.survivorPlayer.findFirst({
      where: { leagueId, userId: league.userId, playerState: { notIn: ['host', 'non_participating_host', 'spectator', 'viewer'] } },
      select: { id: true },
    }),
    db.roster.findFirst({ where: { leagueId, platformUserId: league.userId }, select: { id: true } }),
  ])
  return !player && !roster
}
