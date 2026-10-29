import "server-only"
import { prisma } from "@/lib/prisma"
import { isOfficialTeamName } from "./playoffBracketProjection"

/** The knockout field, ordered by conference seed. Group play is not part of this bracket. */
export type NbaCupField = {
  season: number
  east: string[]
  west: string[]
  enteredByUserId: string | null
  enteredAt: string
}

export function nbaCupFieldCacheKey(season: number): string {
  return `NBA:nba_cup_field:${season}`
}

export function validateNbaCupField(input: unknown):
  | { ok: true; east: string[]; west: string[] }
  | { ok: false; errors: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["Enter East and West seed lists."] }
  }
  const raw = input as Record<string, unknown>
  const errors: string[] = []
  const normalize = (side: "east" | "west"): string[] => {
    const value = raw[side]
    if (!Array.isArray(value) || value.length !== 4) {
      errors.push(`Enter exactly four ${side} teams in seed order.`)
      return []
    }
    return value.map((item) => String(item ?? "").replace(/\s+/g, " ").trim())
  }
  const east = normalize("east")
  const west = normalize("west")
  const seen = new Map<string, string>()
  for (const [side, teams] of [["east", east], ["west", west]] as const) {
    teams.forEach((name, index) => {
      const label = `${side} #${index + 1}`
      if (!name || name.length > 60 || /^(EAST|WEST)\d+$/i.test(name) || !isOfficialTeamName(name)) {
        errors.push(`${label} must be a real team name (1–60 characters).`)
      }
      const earlier = seen.get(name.toLowerCase())
      if (name && earlier) errors.push(`${label} duplicates ${earlier}.`)
      if (name) seen.set(name.toLowerCase(), label)
    })
  }
  return errors.length ? { ok: false, errors } : { ok: true, east, west }
}

export async function readNbaCupField(season: number): Promise<NbaCupField | null> {
  const row = await prisma.sportsDataCache.findUnique({
    where: { cacheKey: nbaCupFieldCacheKey(season) }, select: { data: true },
  })
  if (!row) return null
  const data = row.data as Partial<NbaCupField> | null
  const checked = validateNbaCupField(data)
  if (!checked.ok) return null
  return {
    season, east: checked.east, west: checked.west,
    enteredByUserId: typeof data?.enteredByUserId === "string" ? data.enteredByUserId : null,
    enteredAt: typeof data?.enteredAt === "string" ? data.enteredAt : "",
  }
}

export async function writeNbaCupField(input: {
  season: number; east: string[]; west: string[]; userId: string | null
}): Promise<NbaCupField> {
  const record: NbaCupField = {
    season: input.season, east: input.east, west: input.west,
    enteredByUserId: input.userId, enteredAt: new Date().toISOString(),
  }
  const expiresAt = new Date(Date.UTC(input.season + 3, 0, 1))
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: nbaCupFieldCacheKey(input.season) },
    create: { cacheKey: nbaCupFieldCacheKey(input.season), data: record as any, expiresAt },
    update: { data: record as any, expiresAt },
  })
  return record
}

export function nbaCupSeedMap(field: Pick<NbaCupField, "east" | "west">): Map<string, Map<number, string>> {
  return new Map([
    ["east", new Map(field.east.map((name, index) => [index + 1, name]))],
    ["west", new Map(field.west.map((name, index) => [index + 1, name]))],
  ])
}
