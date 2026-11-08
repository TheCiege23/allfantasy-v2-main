import "server-only"
import { getCfbdApiKey } from "@/lib/cfbd-env"
import { prisma } from "@/lib/prisma"
import { projectCfpRankings, type CfpProjection } from "./cfpRankingsProjection"
import { parseCfpBowlDetails, type CfpBowlDetail } from "./cfpBowlDetails"
import { CFP_BOWLS_CACHE, CFP_PROJECTION_CACHE } from "./cfpPreviewCache"

/** Refresh isolated, read-only preview data; never modify entries, schedules or results. */
export async function syncCfpPreview(input: { season: number; apply: boolean; now?: Date }) {
  const now = input.now ?? new Date()
  if (!input.apply || input.season !== 2026 || now < new Date("2026-11-03T00:00:00Z") || now >= new Date("2027-01-26T00:00:00Z")) return { status: "skipped" }
  const key = getCfbdApiKey()
  if (!key) return { status: "provider-not-configured" }
  const fetchOne = async (url: string) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error("provider unavailable")
    return response.json()
  }
  const refresh = async (cacheKey: string, url: string, kind: "rankings" | "bowls") => {
    try {
      const old = await prisma.sportsDataCache.findUnique({ where: { cacheKey }, select: { data: true } })
      const previous = old?.data as { fetchedAt?: string; value?: unknown } | null
      const age = now.getTime() - Date.parse(previous?.fetchedAt ?? "")
      if (Number.isFinite(age) && age >= 0 && age < 15 * 60 * 1000) return "current"
      const payload = await fetchOne(url)
      let value: CfpProjection | CfpBowlDetail[]
      if (kind === "rankings") {
        const projected = projectCfpRankings(payload)
        if (!projected) return "incomplete"
        const prior = previous?.value as CfpProjection | undefined
        if (prior?.rankingDate && prior.rankingDate > projected.rankingDate) return "older-provider-data"
        value = projected
      } else {
        const bowls = parseCfpBowlDetails(payload)
        const prior = Array.isArray(previous?.value) ? previous.value as CfpBowlDetail[] : []
        value = prior.map(item => ({ ...item }))
        for (const bowl of bowls) {
          const index = value.findIndex(item => item.label === bowl.label)
          if (index < 0) value.push(bowl)
          else value[index] = { ...value[index], ...Object.fromEntries(Object.entries(bowl).filter(([, val]) => val !== undefined)) }
        }
      }
      // Strip absent optional provider fields before writing Prisma JSON.
      const data = JSON.parse(JSON.stringify({ fetchedAt: now.toISOString(), value }))
      const expiresAt = new Date("2029-01-01T00:00:00Z")
      if (old) {
        const updated = await prisma.sportsDataCache.updateMany({ where: { cacheKey, data: { equals: old.data as any } }, data: { data: data as any, expiresAt } })
        return updated.count ? "updated" : "concurrent-update"
      }
      try { await prisma.sportsDataCache.create({ data: { cacheKey, data: data as any, expiresAt } }); return "updated" }
      catch { return "concurrent-update" }
    } catch { return "unavailable" }
  }
  const [rankings, bowls] = await Promise.all([
    refresh(CFP_PROJECTION_CACHE, "https://api.collegefootballdata.com/rankings?year=2026&seasonType=regular", "rankings"),
    refresh(CFP_BOWLS_CACHE, "https://api.collegefootballdata.com/playoffs/cfp?year=2026", "bowls"),
  ])
  return { status: "checked", rankings, bowls }
}
