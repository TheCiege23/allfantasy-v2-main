import 'server-only'

import type { Prisma } from '@prisma/client'
import { getWarmDraftPoolSnapshotFast } from '@/lib/draft-room/ensureDraftPoolReady'
import { entryRookieVerdict, type RookieFilterEntryLike } from '@/lib/draft-room/rookieFilterState'
import { verifyNcaabCollegeDraftPick } from '@/lib/devy/verifyNcaabDraftPick'
import { ANNUAL_C2C_DRAFT } from './annualC2CDraft'

type Db = Pick<Prisma.TransactionClient, 'devyPlayer' | 'sportsDataCache'>
type Candidate = { playerId?: string | null; playerName: string; position: string }
type PoolEntry = RookieFilterEntryLike & { playerId?: string; name?: string; position?: string; poolType?: string }

const key = (value: string | null | undefined) => String(value ?? '').trim().toLowerCase()

/** Verified pool identities only. Never accept rookie hints or college asset types from a client. */
export async function loadAnnualC2CPickPool(leagueId: string) {
  const warm = await getWarmDraftPoolSnapshotFast(leagueId, { allowStale: true })
  const entries = warm.warm && warm.payload.poolType === ANNUAL_C2C_DRAFT && Array.isArray(warm.payload.entries)
    ? warm.payload.entries as PoolEntry[]
    : []
  const eligible = new Map(entries.flatMap(entry =>
    entry.playerId && (entry.poolType === 'college' || entryRookieVerdict(entry) === 'rookie') ? [[entry.playerId, entry] as const] : [],
  ))
  return (candidate: Candidate): 'player' | 'c2c_college' | null => {
    const entry = eligible.get(candidate.playerId ?? '')
    if (!entry || key(entry.name) !== key(candidate.playerName) || key(entry.position) !== key(candidate.position)) return null
    return entry.poolType === 'college' ? 'c2c_college' : 'player'
  }
}

export async function resolveAnnualC2CPick(db: Db, leagueId: string, sport: string, candidate: Candidate) {
  const pick = (await loadAnnualC2CPickPool(leagueId))(candidate)
  if (pick !== 'c2c_college') return pick
  if (sport === 'NBA') {
    return await verifyNcaabCollegeDraftPick(db, { ...candidate, now: new Date() }) ? pick : null
  }
  if (sport !== 'NFL' || !candidate.playerId) return null
  const row = await db.devyPlayer.findUnique({
    where: { id: candidate.playerId },
    select: { sport: true, devyEligible: true, graduatedToNFL: true, name: true, position: true },
  })
  return row?.sport === 'NCAAF' && row.devyEligible && !row.graduatedToNFL &&
    key(row.name) === key(candidate.playerName) && key(row.position) === key(candidate.position) ? pick : null
}
