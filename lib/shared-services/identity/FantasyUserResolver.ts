/**
 * FantasyUserResolver — Identity Service, Fantasy OS Migration Plan Milestone 1.
 *
 * `FantasyUser` is a thin canonical read wrapper, not a new physical table: per the
 * existing `UserProfile` model's own doc comment ("AllFantasy account id (primary).
 * Same as AppUser.id — canonical user key for the product"), `AppUser.id` already IS
 * the canonical FantasyUser identifier. This resolver formalizes that as the Identity
 * Service's public contract without duplicating AppUser's storage.
 */

import { prisma } from '@/lib/prisma'
import type { FantasyUser, FantasyUserId } from './types'

export async function resolveFantasyUser(fantasyUserId: FantasyUserId): Promise<FantasyUser | null> {
  const user = await prisma.appUser.findUnique({
    where: { id: fantasyUserId },
    select: { id: true, displayName: true, email: true, createdAt: true },
  })
  if (!user) return null
  return {
    fantasyUserId: user.id,
    displayName: user.displayName,
    email: user.email,
    createdAt: user.createdAt,
  }
}

/** Bulk variant, for when a service needs to resolve several FantasyUsers at once (e.g. a league's full roster of managers). */
export async function resolveFantasyUsers(fantasyUserIds: FantasyUserId[]): Promise<FantasyUser[]> {
  if (fantasyUserIds.length === 0) return []
  const users = await prisma.appUser.findMany({
    where: { id: { in: fantasyUserIds } },
    select: { id: true, displayName: true, email: true, createdAt: true },
  })
  return users.map((user) => ({
    fantasyUserId: user.id,
    displayName: user.displayName,
    email: user.email,
    createdAt: user.createdAt,
  }))
}
