import "server-only"
import { prisma } from "@/lib/prisma"
import type { SingleGameSport } from "./singleGameSchedule"

export type BracketEventMap = { seriesNumber: number; eventId: string }
export type BracketEventMapRecord = {
  sport: SingleGameSport; season: number; games: BracketEventMap[]
  enteredAt: string; enteredByUserId: string | null
}

export function bracketEventMapKey(sport: SingleGameSport, season: number): string {
  return `BRACKET:${sport}:espn_events:${season}`
}

export function validateBracketEventMaps(sport: SingleGameSport, input: unknown):
  | { ok: true; games: BracketEventMap[] }
  | { ok: false; errors: string[] } {
  if (!Array.isArray(input)) return { ok: false, errors: ["Event IDs must be a list."] }
  const max = sport === "ncaaf" ? 11 : 7
  const errors: string[] = []
  const seenSlots = new Set<number>()
  const seenEvents = new Set<string>()
  const games: BracketEventMap[] = []
  for (const row of input) {
    const value = row && typeof row === "object" ? row as Record<string, unknown> : {}
    const seriesNumber = Number(value.seriesNumber)
    const eventId = String(value.eventId ?? "").trim()
    if (!Number.isInteger(seriesNumber) || seriesNumber < 1 || seriesNumber > max || seenSlots.has(seriesNumber)) {
      errors.push("Each game number must be unique and within the tournament.")
      continue
    }
    seenSlots.add(seriesNumber)
    if (!/^\\d{7,12}$/.test(eventId)) {
      errors.push(`Game ${seriesNumber} needs a numeric ESPN event ID (7–12 digits).`)
      continue
    }
    if (seenEvents.has(eventId)) {
      errors.push(`ESPN event ${eventId} is assigned to more than one game.`)
      continue
    }
    seenEvents.add(eventId)
    games.push({ seriesNumber, eventId })
  }
  return errors.length ? { ok: false, errors } : { ok: true, games: games.sort((a, b) => a.seriesNumber - b.seriesNumber) }
}

export async function readBracketEventMaps(sport: SingleGameSport, season: number): Promise<BracketEventMapRecord | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: bracketEventMapKey(sport, season) }, select: { data: true } })
  if (!row) return null
  const data = row.data as Partial<BracketEventMapRecord> | null
  const checked = validateBracketEventMaps(sport, data?.games)
  if (!checked.ok) return null
  return {
    sport, season, games: checked.games,
    enteredAt: typeof data?.enteredAt === "string" ? data.enteredAt : "",
    enteredByUserId: typeof data?.enteredByUserId === "string" ? data.enteredByUserId : null,
  }
}

export async function writeBracketEventMaps(input: {
  sport: SingleGameSport; season: number; games: BracketEventMap[]; userId: string | null
}): Promise<BracketEventMapRecord> {
  const record: BracketEventMapRecord = {
    sport: input.sport, season: input.season, games: input.games,
    enteredAt: new Date().toISOString(), enteredByUserId: input.userId,
  }
  const cacheKey = bracketEventMapKey(input.sport, input.season)
  const expiresAt = new Date(Date.UTC(input.season + 3, 0, 1))
  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    create: { cacheKey, data: record as any, expiresAt },
    update: { data: record as any, expiresAt },
  })
  return record
}
