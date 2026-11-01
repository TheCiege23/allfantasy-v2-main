import "server-only"
import { isDeepStrictEqual } from "node:util"
import { prisma } from "@/lib/prisma"
import { ESPN_SITE_API_BASE } from "@/lib/providers/espnUrls"
import { assignNbaCupSlots, parseNbaCupScoreboard, type NbaCupGame } from "./nbaCupTournament"
import { nbaCupCacheKey, nbaCupSeriesRows, readNbaCupSnapshot } from "./nbaCupCache"

const dayKey = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "")
/** NBA scoreboard dates follow the US game night, including games after midnight UTC. */
const nbaGameDay = (startsAt: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(startsAt)).replace(/-/g, "")
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

/** Scheduled writer for both schedule publication and verified finals. No admin publication gate. */
export async function syncNbaCupTournament(input: { season: number; apply: boolean; mode?: "live" }) {
  const now = new Date()
  const previous = await readNbaCupSnapshot(input.season)
  const checked = previous?.checkedDates ?? {}
  const today = dayKey(now), yesterday = dayKey(new Date(now.getTime() - 86400000))
  const live = input.mode === "live"
  const liveGames = (previous?.games ?? []).filter((game) => !game.blocked && game.startsAt && game.status !== "final" &&
    Date.parse(game.startsAt) >= now.getTime() - 6 * 3600_000 && Date.parse(game.startsAt) <= now.getTime() + 60_000)
  const candidates = live ? [...new Set(liveGames.map((game) => game.scoreboardDate ?? nbaGameDay(game.startsAt!)))].slice(0, 2)
    : nbaCupDiscoveryDates(input.season, previous?.cursor ?? 0, now)
  const dates = candidates.filter((date) => {
    const age = now.getTime() - Date.parse(checked[date] ?? "")
    return !Number.isFinite(age) || age >= (live ? 30_000 : date === today || date === yesterday ? 4 * 60_000 : 6 * 3600_000)
  }).slice(0, 4)
  if (live && !dates.length) return { applied: false, activeGames: liveGames.filter((game) => game.status === "in_progress").length, gamesPublished: previous?.games.length ?? 0, poolsUpdated: 0, failures: [], outcomes: [] }
  const responses = await Promise.all(dates.map(async (date) => {
    try {
      const response = await fetch(`${ESPN_SITE_API_BASE}/basketball/nba/scoreboard?dates=${date}&limit=1000`, {
        headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`NBA scoreboard HTTP ${response.status}`)
      return { date, games: parseNbaCupScoreboard(await response.json(), input.season).map((game) => ({ ...game, scoreboardDate: date })), error: null }
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
    const changed = new Set<string>()
    const checkedDates = { ...(current?.checkedDates ?? checked) }
    for (const response of responses) {
      if (response.error || Date.parse(checkedDates[response.date] ?? "") > now.getTime()) continue
      checkedDates[response.date] = now.toISOString()
      for (const game of response.games) {
        const prior = merged.get(game.eventId)
        // Stale or incomplete pregame responses must not erase a verified final.
        if (prior?.winnerTeamName && !game.winnerTeamName) continue
        const next = { ...game,
          homeLeaders: game.homeLeaders?.length ? game.homeLeaders : prior?.status === "final" && game.status === "final" ? prior.homeLeaders ?? [] : [],
          awayLeaders: game.awayLeaders?.length ? game.awayLeaders : prior?.status === "final" && game.status === "final" ? prior.awayLeaders ?? [] : [],
        }
        // Compare without the persisted slot, which the scoreboard does not own.
        if (!isDeepStrictEqual({ ...prior, seriesNumber: undefined }, { ...next, seriesNumber: undefined })) changed.add(game.eventId)
        merged.set(game.eventId, next)
      }
    }
    const games = assignNbaCupSlots([...merged.values()], current?.games ?? previous?.games)
    const priorSync = current?.syncedAt ?? previous?.syncedAt ?? ""
    const acceptedResponse = responses.some((row) => !row.error && Date.parse(checkedDates[row.date]) === now.getTime())
    const data = { games, checkedDates, cursor: live ? current?.cursor ?? previous?.cursor ?? 0 : ((current?.cursor ?? 0) + 4) % 92,
      syncedAt: acceptedResponse && (!Number.isFinite(Date.parse(priorSync)) || Date.parse(priorSync) <= now.getTime()) ? now.toISOString() : priorSync }
    const expiresAt = new Date(Date.UTC(input.season + 2, 0, 1))
    await tx.sportsDataCache.upsert({ where: { cacheKey: nbaCupCacheKey(input.season) }, create: { cacheKey: nbaCupCacheKey(input.season), data: data as any, expiresAt }, update: { data: data as any, expiresAt } })
    // Rotate large populations through bounded batches, and never alter test pools.
    const pools = await tx.playoffBracketChallenge.findMany({ where: { sport: "nba_cup", seasonYear: input.season, isTestMode: false }, orderBy: { updatedAt: "asc" }, take: 100, select: { id: true } })
    const ids = pools.map((pool) => pool.id)
    const rows = nbaCupSeriesRows(live ? games.filter((game) => changed.has(game.eventId)) : games)
    if (ids.length && rows.length) {
      await tx.playoffBracketSeries.createMany({ data: pools.flatMap((pool) => rows.filter((game) => game.round === "cup_group_play").map((game) => ({ ...game, challengeId: pool.id, lastSyncedAt: now }))), skipDuplicates: true })
      for (const game of rows) {
        await tx.playoffBracketSeries.updateMany({ where: { challengeId: { in: ids }, seriesNumber: game.seriesNumber }, data: { ...game, lastSyncedAt: now } })
      }
      await tx.playoffBracketChallenge.updateMany({ where: { id: { in: ids } }, data: { updatedAt: now } })
    }
    return { applied: true, gamesPublished: games.length, poolsUpdated: rows.length ? ids.length : 0, failures, outcomes: [],
      activeGames: games.filter((game) => game.status === "in_progress").length }
  }, { timeout: live ? 8000 : 55000, maxWait: live ? 1000 : 5000 })
}
