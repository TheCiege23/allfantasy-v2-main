import "server-only"
import { prisma } from "@/lib/prisma"
import type { BracketTeamProfile, PlayoffSport } from "./types"

function numberOrNull(value: unknown): number | null {
  const n = Number(value)
  return value == null || !Number.isFinite(n) ? null : n
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/** Match conservative aliases only when one cached team fits; ambiguous names stay unavailable. */
export function findTeamProfile(
  name: string,
  rows: Array<{ data: unknown }>,
): BracketTeamProfile | null {
  const target = normalize(name)
  if (!target) return null
  const candidates = rows.map((row) => row.data as Record<string, unknown>)
    .filter((data) => {
      const cached = normalize(String(data?.teamName ?? ""))
      return cached === target || cached.startsWith(target + " ") || cached.endsWith(" " + target)
    })
  if (candidates.length !== 1) return null
  const data = candidates[0]
  const won = numberOrNull(data.won)
  const lost = numberOrNull(data.lost)
  const pointsFor = numberOrNull(data.pointsFor)
  const pointsAgainst = numberOrNull(data.pointsAgainst)
  const played = won != null && lost != null ? won + lost : 0
  const winPercentage = played > 0 ? Math.round(won! / played * 1000) / 10 : null
  const plusMinus = pointsFor != null && pointsAgainst != null ? Math.round(pointsFor - pointsAgainst) : null
  const seasonReview = won != null && lost != null
    ? `${won}-${lost} this season${plusMinus == null ? "" : `; ${plusMinus >= 0 ? "+" : ""}${plusMinus} point differential`}.`
    : "Current season record has not been verified."
  return { won, lost, winPercentage, plusMinus, seasonReview, source: "cached_standings" }
}

export async function loadBracketTeamProfiles(
  sport: PlayoffSport,
  seasonYear: number,
  names: string[],
): Promise<Record<string, BracketTeamProfile>> {
  if (sport !== "ncaaf" && sport !== "nba_cup" && sport !== "nfl") return {}
  const cacheSport = sport === "nba_cup" ? "NBA" : sport === "nfl" ? "NFL" : "NCAAF"
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: `${cacheSport}:standings:${seasonYear}:` } },
    select: { data: true },
  })
  const profiles: Record<string, BracketTeamProfile> = {}
  for (const name of new Set(names)) {
    const hit = findTeamProfile(name, rows)
    if (hit) profiles[name] = hit
  }
  return profiles
}
