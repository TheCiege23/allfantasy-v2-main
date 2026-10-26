import "server-only"
import { prisma } from "@/lib/prisma"

export type SingleGameSport = "ncaaf" | "nba_cup"
export type ScheduledGame = { seriesNumber: number; startsAt: string }
export type SingleGameSchedule = {
  sport: SingleGameSport
  season: number
  games: ScheduledGame[]
  enteredAt: string
  enteredByUserId: string | null
}

export function scheduleCacheKey(sport: SingleGameSport, season: number): string {
  return `BRACKET:${sport}:schedule:${season}`
}

export function validateSingleGameSchedule(sport: SingleGameSport, input: unknown):
  | { ok: true; games: ScheduledGame[] }
  | { ok: false; errors: string[] } {
  const count = sport === "ncaaf" ? 11 : 7
  if (!Array.isArray(input) || input.length !== count) {
    return { ok: false, errors: [`Enter all ${count} game start times.`] }
  }
  const errors: string[] = []
  const games = input.map((row, index) => {
    const value = row && typeof row === "object" ? row as Record<string, unknown> : {}
    const seriesNumber = Number(value.seriesNumber)
    const timestamp = String(value.startsAt ?? "")
    const date = new Date(timestamp)
    if (!Number.isInteger(seriesNumber) || seriesNumber < 1 || seriesNumber > count) {
      errors.push(`Game ${index + 1} has an invalid number.`)
    }
    if (!timestamp || !Number.isFinite(date.getTime()) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) {
      errors.push(`Game ${seriesNumber || index + 1} needs a timestamp with timezone.`)
    }
    return { seriesNumber, startsAt: Number.isFinite(date.getTime()) ? date.toISOString() : "" }
  })
  if (new Set(games.map((game) => game.seriesNumber)).size !== count) {
    errors.push("Every game number must appear exactly once.")
  }
  return errors.length ? { ok: false, errors } : { ok: true, games: games.sort((a, b) => a.seriesNumber - b.seriesNumber) }
}

export async function readSingleGameSchedule(sport: SingleGameSport, season: number): Promise<SingleGameSchedule | null> {
  const row = await prisma.sportsDataCache.findUnique({
    where: { cacheKey: scheduleCacheKey(sport, season) }, select: { data: true },
  })
  if (!row) return null
  const data = row.data as Partial<SingleGameSchedule> | null
  const checked = validateSingleGameSchedule(sport, data?.games)
  if (!checked.ok) return null
  return {
    sport, season, games: checked.games,
    enteredAt: typeof data?.enteredAt === "string" ? data.enteredAt : "",
    enteredByUserId: typeof data?.enteredByUserId === "string" ? data.enteredByUserId : null,
  }
}

export async function writeSingleGameSchedule(input: {
  sport: SingleGameSport; season: number; games: ScheduledGame[]; userId: string | null
}): Promise<SingleGameSchedule> {
  const record: SingleGameSchedule = {
    sport: input.sport, season: input.season, games: input.games,
    enteredAt: new Date().toISOString(), enteredByUserId: input.userId,
  }
  const cacheKey = scheduleCacheKey(input.sport, input.season)
  const expiresAt = new Date(Date.UTC(input.season + 3, 0, 1))
  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    create: { cacheKey, data: record as any, expiresAt },
    update: { data: record as any, expiresAt },
  })
  return record
}
