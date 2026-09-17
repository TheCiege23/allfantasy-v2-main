import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

/**
 * Who may send an @everyone announcement, and to which leagues.
 *
 * - **Who:** the head commissioner AND co-commissioners (user's decision, 2026-09-17). Co-commissioners
 *   already change the league's settings (`requireCommissionerRole`), including the switch that
 *   decides whether a broadcast notifies anyone. The head commissioner still decides who is a
 *   co-commissioner (`requireCommissionerOnly`).
 * - **Where:** leagues AllFantasy runs, only.
 *
 * 🛑 WHY NOT IMPORTED LEAGUES. On an imported league `League.userId` is whoever ran the import, who
 * is often not the league's commissioner, and `getLeagueRole` calls that person "commissioner". A
 * send emails and texts every member with an AllFantasy account, so an imported league let any
 * importer blast a league they don't run. The 10b composer already showed imported leagues
 * read-only for that reason; the format hubs and the draft room did not, and the route did not
 * check. Measured on production 2026-09-17: 0 broadcasts ever sent, in either store, so nothing
 * that worked stops working. Ordinary league chat is unaffected.
 *
 * 🛑 EVERY SURFACE THAT OFFERS A SEND USES THIS FILE, and so does the send. A list that offers a
 * league the send refuses makes a broadcast half-fail with no explanation.
 */

const SENDING_ROLES = new Set(['commissioner', 'co_commissioner'])

export type BroadcastRefusal = 'forbidden' | 'imported'

/** Why this user may not broadcast to this league, or null when they may. */
export async function broadcastRefusal(leagueId: string, userId: string): Promise<BroadcastRefusal | null> {
  const [league, role] = await Promise.all([
    prisma.league.findFirst({ where: { id: leagueId }, select: { platform: true } }),
    getLeagueRole(leagueId, userId),
  ])
  if (!league || !SENDING_ROLES.has(role ?? '')) return 'forbidden'
  return isNativePlatform(league.platform) ? null : 'imported'
}

export type BroadcastLeague = { id: string; platform: string; native: boolean }

/**
 * Leagues this user runs as head commissioner or co-commissioner, on every platform — what the
 * 10b composer lists (it shows imported ones read-only and says why). Use
 * `listSendableLeagueIds` for anything that sends.
 *
 * Owned leagues are commissioner by definition (`getLeagueRole` answers so from `League.userId`
 * before anything else), so only leagues reached through a claimed team's flag are confirmed one by
 * one — which keeps this to a handful of lookups for an owner of dozens of leagues.
 */
export async function listBroadcastLeagues(userId: string, among?: string[]): Promise<BroadcastLeague[]> {
  if (among && among.length === 0) return []
  const scope = among ? { id: { in: among } } : {}
  const [owned, flagged] = await Promise.all([
    prisma.league.findMany({ where: { userId, ...scope }, select: { id: true, platform: true } }),
    prisma.leagueTeam.findMany({
      where: {
        claimedByUserId: userId,
        OR: [{ isCommissioner: true }, { isCoCommissioner: true }],
        ...(among ? { leagueId: { in: among } } : {}),
      },
      select: { leagueId: true },
    }),
  ])
  const ownedIds = new Set(owned.map((l) => l.id))
  const otherIds = [...new Set(flagged.map((t) => t.leagueId))].filter((id) => !ownedIds.has(id))
  const others =
    otherIds.length > 0
      ? await prisma.league.findMany({ where: { id: { in: otherIds } }, select: { id: true, platform: true } })
      : []
  const roles = await Promise.all(others.map((l) => getLeagueRole(l.id, userId)))
  const confirmed = others.filter((_, i) => SENDING_ROLES.has(roles[i] ?? ''))
  return [...owned, ...confirmed].map((l) => ({
    id: l.id,
    platform: String(l.platform ?? ''),
    native: isNativePlatform(l.platform),
  }))
}

/** Leagues this user can actually send an announcement to, optionally within `among`. */
export async function listSendableLeagueIds(userId: string, among?: string[]): Promise<string[]> {
  return (await listBroadcastLeagues(userId, among)).filter((l) => l.native).map((l) => l.id)
}
