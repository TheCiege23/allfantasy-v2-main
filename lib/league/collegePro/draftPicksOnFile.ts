import 'server-only'
import { prisma } from '@/lib/prisma'
import { parseStoredDraftPicks, type PipelinePick } from './pipeline'

/**
 * The stored draft results a college half's players are checked against, and the Fantrax-id ->
 * athlete-id crosswalk that ties a college roster to them. Shared by the roster page's pipeline, the
 * league-wide draft pipeline, and the draft notices, so all three read one answer.
 *
 * Football keys picks by CFBD athlete id (`cfbd:draft-picks:v1:`); basketball by ESPN athlete id
 * (`cbbd:draft-picks:v1:`). Never by name.
 */

export type CollegeDraftSport = 'NCAAF' | 'NCAAB'

export const draftPicksKeyPrefix = (sport: CollegeDraftSport) => (sport === 'NCAAB' ? 'cbbd:draft-picks:v1:' : 'cfbd:draft-picks:v1:')

/** The newest draft on file: this year's, else last year's. Null when neither has picks. */
export async function latestDraftPicksOnFile(sport: CollegeDraftSport, now: Date): Promise<{ year: number; picks: PipelinePick[]; unlinked: number } | null> {
  const prefix = draftPicksKeyPrefix(sport)
  const thisYear = now.getUTCFullYear()
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { in: [`${prefix}${thisYear}`, `${prefix}${thisYear - 1}`] } },
    select: { data: true },
  })
  return (
    rows
      .map((r) => parseStoredDraftPicks(r.data))
      .filter((x): x is NonNullable<typeof x> => x != null && x.picks.length > 0)
      .sort((a, b) => b.year - a.year)[0] ?? null
  )
}

/**
 * Fantrax id -> athlete id through `PlayerIdentityMap`. A Fantrax id that resolves to two different
 * athletes maps to null (left out, never guessed).
 */
export async function athleteIdsByFantraxId(sport: CollegeDraftSport, fantraxIds: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (fantraxIds.length === 0) return out
  const ids = [...new Set(fantraxIds)]
  const identities =
    sport === 'NCAAB'
      ? (await prisma.playerIdentityMap.findMany({
          where: { sport, fantraxId: { in: ids }, espnId: { not: null } },
          select: { fantraxId: true, espnId: true },
        })).map((i) => ({ fantraxId: i.fantraxId, athleteId: i.espnId }))
      : (await prisma.playerIdentityMap.findMany({
          where: { sport, fantraxId: { in: ids }, cfbdId: { not: null } },
          select: { fantraxId: true, cfbdId: true },
        })).map((i) => ({ fantraxId: i.fantraxId, athleteId: i.cfbdId }))
  for (const { fantraxId, athleteId } of identities) {
    if (!fantraxId || !athleteId) continue
    const seen = out.get(fantraxId)
    out.set(fantraxId, seen === undefined || seen === athleteId ? athleteId : null)
  }
  return out
}

/** Every player on a college snapshot's rosters, with the team that holds him. */
export async function collegeSnapshotRoster(snapshotId: string): Promise<Array<{ fantraxId: string; teamName: string }>> {
  const snapshot = await prisma.fantraxLeague.findUnique({ where: { id: snapshotId }, select: { roster: true } }).catch(() => null)
  return (Array.isArray(snapshot?.roster) ? (snapshot!.roster as Array<Record<string, unknown>>) : [])
    .map((r) => ({ fantraxId: String(r?.fantraxId ?? r?.id ?? '').trim(), teamName: String(r?.teamName ?? '').trim() }))
    .filter((r) => r.fantraxId)
}
