import "server-only"
import { prisma } from "@/lib/prisma"
import type { CfpProjection } from "./cfpRankingsProjection"
import type { CfpBowlDetail } from "./cfpBowlDetails"

export const CFP_PROJECTION_CACHE = "BRACKET:cfp:projection:2026"
export const CFP_BOWLS_CACHE = "BRACKET:cfp:bowls:2026"
type RecordData<T> = { fetchedAt: string; value: T }
export async function readCfpPreviewCache<T>(key: string): Promise<RecordData<T> | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } })
  const data = row?.data as RecordData<T> | null
  return data && typeof data.fetchedAt === "string" && data.value != null ? data : null
}
export async function readCfpProjection(): Promise<CfpProjection | null> {
  const data = (await readCfpPreviewCache<CfpProjection>(CFP_PROJECTION_CACHE))?.value
  return data?.season === 2026 && /^2026-\d\d-\d\d$/.test(data.rankingDate) && Array.isArray(data.teams) && data.teams.length === 12 && data.teams.every(x => typeof x === "string") && typeof data.groupSix === "string" ? data : null
}
export async function readCfpBowls(): Promise<CfpBowlDetail[]> {
  const data = (await readCfpPreviewCache<CfpBowlDetail[]>(CFP_BOWLS_CACHE))?.value
  return Array.isArray(data) ? data.filter(game => game && typeof game.label === "string") : []
}
