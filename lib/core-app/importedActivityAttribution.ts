import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Who made a move in `decision_os_imported_activity` — the one attribution rule, shared by every reader
 * that names a manager from that table.
 *
 * The row's own `externalManagerId`/`appUserId`/`rosterId` columns are NULL on every row; attribution
 * is `normalized.managerKeys`: the AllFantasy user id when the manager linked their Sleeper account
 * (reversed through `UserProfile.sleeperUserId`), else a provider key — `sleeper:<id>` or
 * `sleeper:manager:<id>`, where for Sleeper the id IS the platform user id.
 *
 * And the league: one provider league makes one AF `leagues` row PER IMPORTING USER, and the activity
 * attaches to only one of them. A reader keyed on `afLeagueId` alone reads a sibling row as dormant, so
 * the league is matched on `afLeagueId` OR (`provider` AND `providerLeagueId`) — both, so a Sleeper id
 * can never match an ESPN league carrying the same digits.
 */

export type AttributableTeam = {
  externalId: string
  platformUserId: string | null
  claimedByUserId: string | null
}

export function managerKeysOf(normalized: unknown): string[] {
  const raw = (normalized as { managerKeys?: unknown } | null)?.managerKeys
  return Array.isArray(raw) ? raw.map((k) => (k == null ? '' : String(k))).filter(Boolean) : []
}

/** The `where` for one AF league's imported activity, including a sibling importer's rows. */
export function importedActivityLeagueWhere(league: {
  id: string
  platform: string | null
  platformLeagueId: string | null
}): { OR: Array<Record<string, string>> } {
  const provider = league.platform ? String(league.platform).toLowerCase() : null
  return {
    OR: [
      { afLeagueId: league.id },
      ...(provider && league.platformLeagueId ? [{ provider, providerLeagueId: league.platformLeagueId }] : []),
    ],
  }
}

/**
 * A manager key → team resolver. Keys that resolve to nothing are usually an AllFantasy user id for a
 * manager whose team row was never claimed; `withProfileKeys` reads those back through the profile's
 * linked Sleeper id, the same reverse lookup the ingest used to mint the key.
 */
export function teamResolver<T extends AttributableTeam>(teams: readonly T[]) {
  const byKey = new Map<string, T>()
  for (const t of teams) {
    if (t.platformUserId) {
      byKey.set(t.platformUserId, t)
      byKey.set(`sleeper:${t.platformUserId}`, t)
      byKey.set(`sleeper:manager:${t.platformUserId}`, t)
    }
    if (t.claimedByUserId) byKey.set(t.claimedByUserId, t)
    byKey.set(t.externalId, t)
  }
  const resolve = (k: string): T | undefined => {
    const direct = byKey.get(k)
    if (direct) return direct
    const tail = k.includes(':') ? k.slice(k.lastIndexOf(':') + 1) : null
    return tail ? byKey.get(tail) : undefined
  }
  /** Teach the resolver AF user ids it could not place, from their linked Sleeper ids. */
  const withProfileKeys = async (keys: Iterable<string>): Promise<void> => {
    const unresolved = [...new Set(keys)].filter((k) => !resolve(k))
    if (unresolved.length === 0) return
    const profiles = await prisma.userProfile
      .findMany({ where: { userId: { in: unresolved } }, select: { userId: true, sleeperUserId: true } })
      .catch(() => [] as Array<{ userId: string; sleeperUserId: string | null }>)
    for (const p of profiles) {
      const t = p.sleeperUserId ? byKey.get(p.sleeperUserId) : undefined
      if (t) byKey.set(p.userId, t)
    }
  }
  return { resolve, withProfileKeys }
}
