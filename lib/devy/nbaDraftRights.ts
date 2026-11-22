import type { Prisma } from '@prisma/client'
import { resolveDevySeasonYear } from '@/lib/devy/rightsWriter'

export type NbaCollegeAssetType = 'c2c_college' | 'devy_pick'
export type DraftCollegePick = { playerId: string | null; rosterId: string; assetType: string | null; pickMetadata: unknown }
type RightsDb = Pick<Prisma.TransactionClient, 'devyRights' | '$queryRaw'>

async function lockPlayerRights(db: RightsDb, leagueId: string, playerId: string): Promise<void> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${leagueId}), hashtext(${playerId}))::text AS locked`
}

function draftRightId(pick: DraftCollegePick): string | null {
  if (!/^espn:ncaab:\d+$/.test(pick.playerId ?? '') || !['c2c_college', 'devy_pick'].includes(pick.assetType ?? '')) return null
  const data = pick.pickMetadata && typeof pick.pickMetadata === 'object' && !Array.isArray(pick.pickMetadata) ? pick.pickMetadata as Record<string, unknown> : {}
  if (typeof data.draftCollegeRightsId !== 'string' || !data.draftCollegeRightsId) throw Object.assign(new Error('This college pick has no verifiable draft ownership record.'), { status: 409 })
  return data.draftCollegeRightsId
}

/** Draft rights are tied to a specific pick; never alter an unrelated or transferred right. */
export async function removeDraftCollegeRight(db: RightsDb, leagueId: string, pick: DraftCollegePick): Promise<void> {
  const id = draftRightId(pick)
  if (!id) return
  await lockPlayerRights(db, leagueId, pick.playerId!)
  const deleted = await db.devyRights.deleteMany({ where: { id, leagueId, rosterId: pick.rosterId, devyPlayerId: pick.playerId!, state: pick.assetType === 'c2c_college' ? 'COLLEGE_ACTIVE' : 'NCAA_DEVY_ACTIVE' } })
  if (deleted.count !== 1) throw Object.assign(new Error('College ownership changed; refresh the draft before editing this pick.'), { status: 409 })
}

export async function createDraftCollegeRight(db: RightsDb, input: { leagueId: string; rosterId: string; playerId: string; assetType: NbaCollegeAssetType }): Promise<string> {
  await lockPlayerRights(db, input.leagueId, input.playerId)
  const found = await db.devyRights.findFirst({ where: { leagueId: input.leagueId, devyPlayerId: input.playerId }, select: { id: true } })
  if (found) throw Object.assign(new Error('College player already has rights in this league.'), { status: 409 })
  const right = await db.devyRights.create({ data: { leagueId: input.leagueId, rosterId: input.rosterId, devyPlayerId: input.playerId, state: input.assetType === 'c2c_college' ? 'COLLEGE_ACTIVE' : 'NCAA_DEVY_ACTIVE', seasonYear: resolveDevySeasonYear(), sourceConfidence: 100 }, select: { id: true } })
  return right.id
}

export async function transferDraftCollegeRight(db: RightsDb, leagueId: string, pick: DraftCollegePick, newRosterId: string): Promise<void> {
  const id = draftRightId(pick)
  if (!id) return
  await lockPlayerRights(db, leagueId, pick.playerId!)
  const competing = await db.devyRights.findFirst({ where: { leagueId, devyPlayerId: pick.playerId!, NOT: { id } }, select: { id: true } })
  if (competing) throw Object.assign(new Error('College player has conflicting ownership in this league.'), { status: 409 })
  const moved = await db.devyRights.updateMany({ where: { id, leagueId, rosterId: pick.rosterId, devyPlayerId: pick.playerId!, state: pick.assetType === 'c2c_college' ? 'COLLEGE_ACTIVE' : 'NCAA_DEVY_ACTIVE' }, data: { rosterId: newRosterId } })
  if (moved.count !== 1) throw Object.assign(new Error('College ownership changed; refresh the draft before editing this pick.'), { status: 409 })
}
