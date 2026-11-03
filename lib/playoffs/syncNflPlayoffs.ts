import "server-only"
import { prisma } from "@/lib/prisma"
import { ESPN_SITE_API_BASE } from "@/lib/providers/espnUrls"
import { applyPlayoffSeedsToChallenges, resolvePlayoffSeedField } from "./playoffSeeding"
import { assignNflSlots, orientToSlot, parseNflPlayoffScoreboard, type NflPlayoffGame } from "./nflPlayoffs"

/**
 * Scheduled writer for NFL playoff bracket pools: schedules, live scores and
 * finals from the ESPN postseason scoreboard (contracts/espn, scoreboard.NFL.*).
 *
 * Same shape as `syncNbaCupTournament`: it is the ONLY module that reads the
 * provider for these pools; pool pages read the rows it writes.
 *
 * ⚠ IT PLACES NOTHING UNTIL THE SEEDED FIELD IS FINAL. ESPN carries no seeds
 * (GAPS.md P-01), so a game can only be put in a slot by matching its teams to
 * the standings-seeded field — and a game that does not match is reported and
 * skipped, never guessed into a slot.
 */

const dayKey = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "")
export const nflPlayoffsCacheKey = (season: number) => `BRACKET:nfl:automatic:${season}`
export type NflPlayoffsSnapshot = { games: NflPlayoffGame[]; checkedDates: Record<string, string>; cursor: number; syncedAt: string }

/**
 * The postseason window, in the calendar year AFTER the season starts:
 * Wild Card weekend is the second weekend of January, the Super Bowl the
 * second Sunday of February. Generous at both ends; a day with no games costs
 * one empty request.
 */
export function nflPostseasonDays(season: number): string[] {
  const days: string[] = []
  for (let d = new Date(Date.UTC(season + 1, 0, 6)); d <= new Date(Date.UTC(season + 1, 1, 20)); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(dayKey(d))
  }
  return days
}

/** True from New Year's Day to a week after the latest possible Super Bowl. Outside it, no provider call. */
export function nflPostseasonWindowOpen(season: number, now = new Date()): boolean {
  return now.getTime() >= Date.UTC(season + 1, 0, 1) && now.getTime() <= Date.UTC(season + 1, 1, 27)
}

export async function readNflPlayoffsSnapshot(season: number): Promise<NflPlayoffsSnapshot | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: nflPlayoffsCacheKey(season) }, select: { data: true } })
  const data = row?.data as NflPlayoffsSnapshot | null
  return data && Array.isArray(data.games) ? data : null
}

/**
 * The row updates for every placed game. Home/away follow the TEMPLATE's
 * orientation (better seed home; AFC home in the Super Bowl), and a reseeded
 * divisional row carries the seeds of the teams actually in it.
 */
export function nflSeriesRows(games: NflPlayoffGame[], seeds: Map<string, Map<number, string>>) {
  const { placed, rejected } = assignNflSlots(games, seeds)
  const seedOf = (conf: string, name: string) => {
    for (const [n, team] of seeds.get(conf) ?? new Map<number, string>()) if (team === name) return n
    return 0
  }
  const afc = new Set((seeds.get("afc") ?? new Map()).values())
  const rows = placed.map((game) => {
    const conf = game.conference === "finals" ? null : game.conference
    let slotHome: string | null
    if (!conf) slotHome = afc.has(game.homeTeamName) ? game.homeTeamName : afc.has(game.awayTeamName) ? game.awayTeamName : null
    else {
      const hs = seedOf(conf, game.homeTeamName), as = seedOf(conf, game.awayTeamName)
      slotHome = hs && as ? (hs < as ? game.homeTeamName : game.awayTeamName) : null
    }
    const side = orientToSlot(game, slotHome)
    return {
      seriesNumber: game.seriesNumber,
      homeTeamName: side.homeTeamName,
      awayTeamName: side.awayTeamName,
      ...(conf ? { homeSeed: seedOf(conf, side.homeTeamName), awaySeed: seedOf(conf, side.awayTeamName) } : {}),
      startsAt: game.startsAt ? new Date(game.startsAt) : null,
      status: game.status,
      winnerTeamName: game.winnerTeamName,
      venue: game.venue,
      liveHomeScore: side.homeScore,
      liveAwayScore: side.awayScore,
      liveStatus: game.status === "in_progress" ? game.statusDetail ?? "In progress" : game.status,
      seriesSummary: game.winnerTeamName && side.homeScore != null && side.awayScore != null ? `${side.homeScore}–${side.awayScore}` : null,
      providerGamesJson: { provider: "espn_nfl_playoffs", eventId: game.eventId, gameLabel: game.label, location: game.location },
    }
  })
  return { rows, rejected }
}

export async function syncNflPlayoffs(input: { season: number; apply: boolean; now?: Date }) {
  const now = input.now ?? new Date()
  if (!nflPostseasonWindowOpen(input.season, now)) {
    return { applied: false, skipped: "outside_postseason_window", failures: [] as Array<{ date: string; error: string | null }>, outcomes: [] }
  }
  const previous = await readNflPlayoffsSnapshot(input.season)
  const checked = previous?.checkedDates ?? {}
  const today = dayKey(now), yesterday = dayKey(new Date(now.getTime() - 86_400_000))
  const all = nflPostseasonDays(input.season)
  const cursor = previous?.cursor ?? 0
  const rotating = [...all.slice(cursor % all.length), ...all.slice(0, cursor % all.length)]
  const dates = [...new Set([today, yesterday, ...rotating])].filter((date) => all.includes(date)).filter((date) => {
    const age = now.getTime() - Date.parse(checked[date] ?? "")
    return !Number.isFinite(age) || age >= (date === today || date === yesterday ? 4 * 60_000 : 6 * 3600_000)
  }).slice(0, 4)

  const responses = await Promise.all(dates.map(async (date) => {
    try {
      const response = await fetch(`${ESPN_SITE_API_BASE}/football/nfl/scoreboard?dates=${date}&limit=1000`, {
        headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`NFL scoreboard HTTP ${response.status}`)
      return { date, games: parseNflPlayoffScoreboard(await response.json(), input.season), error: null }
    } catch (error) {
      return { date, games: [] as NflPlayoffGame[], error: error instanceof Error ? error.message : "Scoreboard unavailable" }
    }
  }))
  const failures = responses.filter((r) => r.error).map((r) => ({ date: r.date, error: r.error }))
  if (!input.apply) return { applied: false, gamesDiscovered: responses.flatMap((r) => r.games).length, failures, outcomes: [] }

  const field = await resolvePlayoffSeedField("nfl", input.season)
  const pools = await (prisma as any).playoffBracketChallenge.findMany({
    where: { sport: "nfl", seasonYear: input.season, isTestMode: false },
    orderBy: { updatedAt: "asc" }, take: 100, select: { id: true },
  })
  const ids: string[] = pools.map((pool: { id: string }) => pool.id)
  // Seed placeholders first (and migrate any pick of them), so the rows written below match.
  const seeding = field.isFinal && ids.length ? await applyPlayoffSeedsToChallenges(ids) : null

  return prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${nflPlayoffsCacheKey(input.season)})) AS acquired`
    if (!lock?.acquired) return { applied: false, skipped: "sync_already_running", failures, outcomes: [] }
    const row = await tx.sportsDataCache.findUnique({ where: { cacheKey: nflPlayoffsCacheKey(input.season) }, select: { data: true } })
    const current = row?.data as NflPlayoffsSnapshot | null
    const merged = new Map((current?.games ?? previous?.games ?? []).map((game) => [game.eventId, game]))
    const checkedDates = { ...(current?.checkedDates ?? checked) }
    for (const response of responses) {
      if (response.error) continue
      checkedDates[response.date] = now.toISOString()
      for (const game of response.games) {
        // A stale pregame read must never erase a verified final.
        if (merged.get(game.eventId)?.winnerTeamName && !game.winnerTeamName) continue
        merged.set(game.eventId, game)
      }
    }
    const games = [...merged.values()]
    const data: NflPlayoffsSnapshot = { games, checkedDates, cursor: (cursor + 4) % all.length, syncedAt: now.toISOString() }
    const expiresAt = new Date(Date.UTC(input.season + 2, 0, 1))
    await tx.sportsDataCache.upsert({
      where: { cacheKey: nflPlayoffsCacheKey(input.season) },
      create: { cacheKey: nflPlayoffsCacheKey(input.season), data: data as any, expiresAt },
      update: { data: data as any, expiresAt },
    })
    if (!field.isFinal) {
      return { applied: true, gamesDiscovered: games.length, gamesPublished: 0, poolsUpdated: 0, fieldFinal: false, warnings: field.warnings, failures, outcomes: [] }
    }
    const { rows, rejected } = nflSeriesRows(games, field.seeds)
    if (ids.length && rows.length) {
      for (const update of rows) {
        await tx.playoffBracketSeries.updateMany({ where: { challengeId: { in: ids }, seriesNumber: update.seriesNumber }, data: { ...update, lastSyncedAt: now } })
      }
      await tx.playoffBracketChallenge.updateMany({ where: { id: { in: ids } }, data: { updatedAt: now } })
    }
    return {
      applied: true, gamesDiscovered: games.length, gamesPublished: rows.length, poolsUpdated: ids.length, fieldFinal: true,
      slotsSeeded: seeding?.slotsFilled ?? 0,
      rows: rejected.map((r) => ({ outcome: "not-in-seeded-field", eventId: r.game.eventId, reason: r.reason })),
      warnings: field.warnings, failures, outcomes: [],
    }
  }, { timeout: 55000, maxWait: 5000 })
}
