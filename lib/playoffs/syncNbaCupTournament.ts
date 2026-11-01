import "server-only"
import { prisma } from "@/lib/prisma"
import { ESPN_SITE_API_BASE } from "@/lib/providers/espnUrls"
import { assignNbaCupSlots, parseNbaCupScoreboard, type NbaCupGame } from "./nbaCupTournament"
import { nbaCupCacheKey, nbaCupSeriesRows, readNbaCupSnapshot } from "./nbaCupCache"

const dayKey = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "")
/** Published dates speed initial discovery; labels, never dates, establish Cup membership.
 * https://www.nba.com/news/emirates-nba-cup-key-dates-schedule
 * Other seasons are discovered by the rotating October–December scan below.
 */
const PUBLISHED_2026 = ["20261030", "20261106", "20261113", "20261120", "20261124", "20261125", "20261127", "20261204", "20261205", "20261208", "20261209", "20261211"]

export function nbaCupDiscoveryDates(season: number, cursor: number, now = new Date()): string[] {
  const days: string[] = []
  for (let date = new Date(Date.UTC(season, 9, 1)); date.getUTCFullYear() === season; date.setUTCDate(date.getUTCDate() + 1)) days.push(dayKey(date))
  const rotating = [...days.slice(cursor % days.length), ...days.slice(0, cursor % days.length)]
  const live = now.getUTCFullYear() === season ? [dayKey(now), dayKey(new Date(now.getTime() - 86400000))] : []
  return [...new Set([...live, ...(season === 2026 ? PUBLISHED_2026 : []), ...rotating])]
}

/**
 * Scheduled writer for both schedule publication and verified finals. No admin publication gate.
 *
 * `liveOnly` is the minute-level tick: it re-reads only today's and yesterday's
 * scoreboards (UTC dates, which together cover a late-night Eastern tipoff), and
 * accepts a 45s-old read instead of the 4-minute floor the discovery scan uses.
 */
export async function syncNbaCupTournament(input: { season: number; apply: boolean; liveOnly?: boolean }) {
  const now = new Date()
  const previous = await readNbaCupSnapshot(input.season)
  const checked = previous?.checkedDates ?? {}
  const today = dayKey(now), yesterday = dayKey(new Date(now.getTime() - 86400000))
  const recentFloorMs = input.liveOnly ? 45_000 : 4 * 60_000
  const candidates = input.liveOnly ? [today, yesterday] : nbaCupDiscoveryDates(input.season, previous?.cursor ?? 0, now)
  const dates = candidates.filter((date) => {
    const age = now.getTime() - Date.parse(checked[date] ?? "")
    return !Number.isFinite(age) || age >= (date === today || date === yesterday ? recentFloorMs : 6 * 3600_000)
  }).slice(0, 4)
  if (input.liveOnly && dates.length === 0) return { applied: false, skipped: "recently_checked", gamesDiscovered: 0, failures: [] as Array<{ date: string; error: string | null }>, outcomes: [] }
  const responses = await Promise.all(dates.map(async (date) => {
    try {
      const response = await fetch(`${ESPN_SITE_API_BASE}/basketball/nba/scoreboard?dates=${date}&limit=1000`, {
        headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`NBA scoreboard HTTP ${response.status}`)
      return { date, games: parseNbaCupScoreboard(await response.json(), input.season), error: null }
    } catch (error) {
      return { date, games: [] as NbaCupGame[], error: error instanceof Error ? error.message : "Scoreboard unavailable" }
    }
  }))
  const failures = responses.filter((row) => row.error).map((row) => ({ date: row.date, error: row.error }))
  if (!input.apply) return { applied: false, gamesDiscovered: responses.flatMap((row) => row.games).length, failures, outcomes: [] }

  return prisma.$transaction(async (tx) => {
    // A duplicate cron run must not reassign slots or overwrite a newer season snapshot.
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${nbaCupCacheKey(input.season)})) AS acquired`
    if (!lock?.acquired) return { applied: false, skipped: "sync_already_running", failures, outcomes: [] }
    const row = await tx.sportsDataCache.findUnique({ where: { cacheKey: nbaCupCacheKey(input.season) }, select: { data: true } })
    const current = row?.data as typeof previous
    const merged = new Map((current?.games ?? previous?.games ?? []).map((game) => [game.eventId, game]))
    const checkedDates = { ...(current?.checkedDates ?? checked) }
    for (const response of responses) {
      if (response.error || Date.parse(checkedDates[response.date] ?? "") > now.getTime()) continue
      checkedDates[response.date] = now.toISOString()
      for (const game of response.games) {
        const prior = merged.get(game.eventId)
        // Stale or incomplete pregame responses must not erase a verified final.
        if (prior?.winnerTeamName && !game.winnerTeamName) continue
        merged.set(game.eventId, game)
      }
    }
    const games = assignNbaCupSlots([...merged.values()], current?.games ?? previous?.games)
    // The live tick does not advance the discovery cursor; only the full scan walks the season.
    const data = { games, checkedDates, cursor: input.liveOnly ? current?.cursor ?? 0 : ((current?.cursor ?? 0) + 4) % 92, syncedAt: now.toISOString() }
    const expiresAt = new Date(Date.UTC(input.season + 2, 0, 1))
    await tx.sportsDataCache.upsert({ where: { cacheKey: nbaCupCacheKey(input.season) }, create: { cacheKey: nbaCupCacheKey(input.season), data: data as any, expiresAt }, update: { data: data as any, expiresAt } })
    // Rotate large populations through bounded batches, and never alter test pools.
    const pools = await tx.playoffBracketChallenge.findMany({ where: { sport: "nba_cup", seasonYear: input.season, isTestMode: false }, orderBy: { updatedAt: "asc" }, take: 100, select: { id: true } })
    const ids = pools.map((pool) => pool.id)
    const rows = nbaCupSeriesRows(games)
    if (ids.length && rows.length) {
      await tx.playoffBracketSeries.createMany({ data: pools.flatMap((pool) => rows.filter((game) => game.round === "cup_group_play").map((game) => ({ ...game, challengeId: pool.id, lastSyncedAt: now }))), skipDuplicates: true })
      for (const game of rows) {
        await tx.playoffBracketSeries.updateMany({ where: { challengeId: { in: ids }, seriesNumber: game.seriesNumber }, data: { ...game, lastSyncedAt: now } })
      }
      await tx.playoffBracketChallenge.updateMany({ where: { id: { in: ids } }, data: { updatedAt: now } })
    }
    return { applied: true, gamesPublished: rows.length, poolsUpdated: ids.length, failures, outcomes: [] }
  }, { timeout: 55000, maxWait: 5000 })
}
