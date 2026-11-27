import 'server-only'
import type { Prisma } from '@prisma/client'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'

const inactive = (status: string | null) => ['INACT', 'INACTIVE', 'RETIRED', 'RET'].includes((status ?? '').trim().toUpperCase())
/** Native NFL pool IDs are Sleeper IDs. Never interpret an equal RI numeric ID as that player. */
export async function verifiedSGInactivePlayer(db: Prisma.TransactionClient, sport: string, playerId: string) {
  const rows = await db.sportsPlayer.findMany({ where: { sport, source: sport === 'NFL' ? 'sleeper' : 'rolling_insights',
    OR: sport === 'NFL' ? [{ sleeperId: playerId }, { externalId: `sleeper:${playerId}` }] : [{ externalId: playerId }] },
    select: { name: true, status: true, team: true, fetchedAt: true }, orderBy: { fetchedAt: 'desc' } })
  if (!rows.length || new Set(rows.map(row => canonicalName(row.name))).size !== 1) return null
  const player = rows[0]
  if (inactive(player.status)) return player
  // Some old Sleeper retired profiles remain labelled Active. A sport-scoped,
  // name-checked crosswalk can supply RI's explicit inactive status, never the raw ID.
  if (sport !== 'NFL' || player.team) return null
  const identity = await db.playerIdentityMap.findUnique({ where: { sleeperId: playerId, sport }, select: { sport: true, rollingInsightsId: true, canonicalName: true } })
  if (identity?.sport !== sport || !identity.rollingInsightsId || canonicalName(identity.canonicalName) !== canonicalName(player.name)) return null
  const profile = await db.sportsPlayer.findUnique({ where: { sport_externalId_source: { sport, externalId: identity.rollingInsightsId, source: 'rolling_insights' } },
    select: { name: true, status: true } })
  return profile && inactive(profile.status) && canonicalName(profile.name) === canonicalName(player.name) ? player : null
}

/** Metadata for native draft-pool IDs, never a bare ID from a different provider. */
export async function verifiedSGNativePlayer(db: Prisma.TransactionClient, sport: string, playerId: string) {
  const id = sport === 'NFL' && playerId.startsWith('nfl:def:') ? playerId.slice(8) : playerId
  const rows = await db.sportsPlayer.findMany({ where: { sport, source: sport === 'NFL' ? 'sleeper' : 'rolling_insights',
    OR: sport === 'NFL' ? [{ sleeperId: id }, { externalId: 'sleeper:' + id }] : [{ externalId: id }] },
    select: { name: true, position: true, team: true }, orderBy: { fetchedAt: 'desc' } })
  if (!rows.length || new Set(rows.map(row => canonicalName(row.name))).size !== 1) return null
  return rows[0]
}
