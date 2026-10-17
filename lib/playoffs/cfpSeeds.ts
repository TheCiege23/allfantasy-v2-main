import "server-only"
import { prisma } from "@/lib/prisma"
import { isOfficialTeamName } from "./playoffBracketProjection"

/**
 * College Football Playoff seeds — ENTERED BY AN ADMIN, read by seeding.
 *
 * ⚠ WHY A HUMAN TYPES THESE. Owner call, 2026-10-01: no feed this repo reads
 * carries the selection committee's seeds, and they are not derivable from a
 * poll — the five highest-ranked conference champions are guaranteed spots, so
 * the field is not simply the top twelve. A wrong seed silently mis-builds every
 * pool's bracket, so the one input that decides everything gets a human check.
 *
 * Stored in `SportsDataCache` under `NCAAF:cfp_seeds:<season>` — the same table
 * every other seed source lives in — as twelve names in SEED ORDER (index 0 is
 * the #1 seed). `resolvePlayoffSeedField` reads it for `ncaaf`; this module
 * never touches a provider.
 *
 * Season is the college football season year: the 2026 season's playoff is
 * played December 2026 – January 2027 and is season 2026.
 */

export const CFP_FIELD_SIZE = 12

export function cfpSeedsCacheKey(season: number): string {
  return `NCAAF:cfp_seeds:${season}`
}

export type CfpSeedsRecord = {
  season: number
  /** Twelve team names, index 0 = #1 seed. */
  seeds: string[]
  enteredByUserId: string | null
  enteredAt: string
}

export type CfpSeedValidation =
  | { ok: true; seeds: string[] }
  | { ok: false; errors: string[] }

/** The engine's own seed placeholder for the CFP — a saved name must never look like one. */
const CFP_PLACEHOLDER = /^CFP\d+$/i
const MAX_NAME_LENGTH = 60

/**
 * Validate an admin's twelve seeds. Pure, so it is tested without a database.
 *
 * Every rule here exists because breaking it corrupts pools without an error:
 * - exactly twelve, non-empty — a missing seed leaves a slot unpickable forever
 * - unique (case-insensitive) — two seeds with one name make a pick of that
 *   name ambiguous between two games
 * - not a placeholder (`CFP3`, `Winner S2`, "… Champion") — the engine treats
 *   those as UNSETTLED, so a team saved under one would never be pickable, and
 *   `CFP3` would be re-replaced by the next seeding pass
 */
export function validateCfpSeeds(input: unknown): CfpSeedValidation {
  const errors: string[] = []
  if (!Array.isArray(input)) return { ok: false, errors: ["Seeds must be a list of 12 team names."] }
  if (input.length !== CFP_FIELD_SIZE) {
    return { ok: false, errors: [`Enter exactly ${CFP_FIELD_SIZE} teams (got ${input.length}).`] }
  }

  const seeds = input.map((raw) => String(raw ?? "").replace(/\s+/g, " ").trim())
  const seen = new Map<string, number>()
  seeds.forEach((name, index) => {
    const seed = index + 1
    if (!name) {
      errors.push(`Seed ${seed} is empty.`)
      return
    }
    if (name.length > MAX_NAME_LENGTH) errors.push(`Seed ${seed} is longer than ${MAX_NAME_LENGTH} characters.`)
    if (CFP_PLACEHOLDER.test(name) || !isOfficialTeamName(name)) {
      errors.push(`Seed ${seed} ("${name}") looks like a placeholder, not a team name.`)
    }
    const key = name.toLowerCase()
    const earlier = seen.get(key)
    if (earlier != null) errors.push(`Seed ${seed} repeats seed ${earlier} ("${name}").`)
    else seen.set(key, seed)
  })

  return errors.length > 0 ? { ok: false, errors } : { ok: true, seeds }
}

export async function readCfpSeeds(season: number): Promise<CfpSeedsRecord | null> {
  const row = await prisma.sportsDataCache.findUnique({
    where: { cacheKey: cfpSeedsCacheKey(season) },
    select: { data: true },
  })
  if (!row) return null
  const data = row.data as Partial<CfpSeedsRecord> | null
  const checked = validateCfpSeeds(data?.seeds)
  // A stored record that no longer validates is treated as absent — never seed from it.
  if (!checked.ok) return null
  return {
    season,
    seeds: checked.seeds,
    enteredByUserId: typeof data?.enteredByUserId === "string" ? data.enteredByUserId : null,
    enteredAt: typeof data?.enteredAt === "string" ? data.enteredAt : "",
  }
}

/**
 * Persist the twelve seeds. The caller validates first.
 *
 * `expiresAt` is set years out: `SportsDataCache` is a cache table with an
 * expiry index, and a sweeper that clears expired rows must never delete the
 * seeds of a playoff people still have pools in.
 */
export async function writeCfpSeeds(input: { season: number; seeds: string[]; userId: string | null }): Promise<CfpSeedsRecord> {
  const record: CfpSeedsRecord = {
    season: input.season,
    seeds: input.seeds,
    enteredByUserId: input.userId,
    enteredAt: new Date().toISOString(),
  }
  const expiresAt = new Date(Date.UTC(input.season + 3, 0, 1))
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: cfpSeedsCacheKey(input.season) },
    create: { cacheKey: cfpSeedsCacheKey(input.season), data: record as any, expiresAt },
    update: { data: record as any, expiresAt },
  })
  return record
}

/**
 * The seed field the generic seeding path consumes.
 *
 * CFP seeds are NATIONAL, but `applyPlayoffSeedsToChallenge` looks a slot's
 * seed up under its row's half — so the one national map is offered under both
 * halves. The `finals` row never holds a seed placeholder, so it needs none.
 */
export function cfpSeedMapByHalf(seeds: string[]): Map<string, Map<number, string>> {
  const national = new Map<number, string>(seeds.map((name, index) => [index + 1, name]))
  return new Map([
    ["upper", national],
    ["lower", national],
  ])
}

/**
 * Seeds whose name CHANGED between two saves — the typo corrections.
 * Seeding only ever replaces placeholders, so a pool already seeded with
 * "Ohio Sate" is never revisited; these renames are applied separately.
 */
export function cfpSeedCorrections(previous: string[] | null, next: string[]): Array<{ seed: number; from: string; to: string }> {
  if (!previous) return []
  const out: Array<{ seed: number; from: string; to: string }> = []
  next.forEach((name, index) => {
    const before = previous[index]
    if (before && before !== name) out.push({ seed: index + 1, from: before, to: name })
  })
  return out
}
