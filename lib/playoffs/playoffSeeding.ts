import "server-only"
import { prisma } from "@/lib/prisma"
import type { PlayoffSport } from "./types"

/**
 * Fill a bracket's seed slots with the clubs that actually made the postseason.
 *
 * ⚠ THIS IS THE STEP THAT LETS A POOL EXIST BEFORE GAME ONE. The other way a
 * bracket learns team names is `syncPlayoffChallengeSeries` in its
 * `official_bracket` mode, which matches PROVIDER GAMES onto series — and
 * before the postseason starts there are no games to match, so that path
 * cannot populate a field. Seeding reads standings instead, which exist the
 * moment the regular season ends.
 *
 * 🛑 IT READS THE DATABASE, NEVER A PROVIDER. `/api/cron/import-standings`
 * writes `SportsDataCache` under `<SPORT>:standings:<season>:<abbrev>`; this is
 * the read side of that. Do not add a fetch here — the DB-first boundary is the
 * whole reason the ingestion job exists.
 */

/** ESPN's standings group name -> the `conference` value the templates use. */
const CONFERENCE_FROM_GROUP: Array<{ match: RegExp; conference: string }> = [
  { match: /^american league/i, conference: "al" },
  { match: /^national league/i, conference: "nl" },
  { match: /^eastern/i, conference: "east" },
  { match: /^western/i, conference: "west" },
]

/**
 * A seed slot that no real club has been written into yet.
 *
 * ⚠ THE PATTERN IS THE SAFETY RAIL, and it is deliberately strict. Only a name
 * that still looks exactly like a generated seed slot (`AL1`, `EAST7`) may be
 * replaced. Anything else — a club written by an earlier seeding pass, a name
 * the official-bracket sync matched, or a test pool's fixture clubs — is left
 * alone, which is what makes this safe to run on every cron fire.
 */
const SEED_PLACEHOLDER = /^(AL|NL|EAST|WEST)(\d+)$/i

export type PlayoffSeedField = {
  sport: PlayoffSport
  season: string
  /** conference -> seed -> club name. */
  seeds: Map<string, Map<number, string>>
  /** How many standings rows were read, before the seed cut. */
  rowsRead: number
  warnings: string[]
}

type StandingsRow = {
  team?: unknown
  teamName?: unknown
  position?: unknown
  conference?: unknown
}

function conferenceOf(group: unknown): string | null {
  const value = String(group ?? "").trim()
  if (!value) return null
  return CONFERENCE_FROM_GROUP.find((entry) => entry.match.test(value))?.conference ?? null
}

/**
 * Read the seeded field for a sport and season out of the standings cache.
 *
 * ⚠ EXPIRY IS NOT CHECKED, ON PURPOSE. `SportsDataCache.expiresAt` does not
 * evict (nothing purges on it — the purge is allow-list only), so a row past
 * its TTL is still the most recent standings we hold. Refusing to read one
 * would turn a late ingestion into no bracket at all, and a postseason field
 * does not change once the regular season is over. The ingestion job runs
 * every four hours, which bounds how stale this can be.
 */
export async function resolvePlayoffSeedField(
  sport: PlayoffSport,
  seasonYear: number | string,
): Promise<PlayoffSeedField> {
  const season = String(seasonYear)
  const prefix = `${sport.toUpperCase()}:standings:${season}:`
  const warnings: string[] = []

  const rows = await (prisma.sportsDataCache as any).findMany({
    where: { cacheKey: { startsWith: prefix } },
    select: { data: true },
  })

  const seeds = new Map<string, Map<number, string>>()
  for (const row of rows as Array<{ data: StandingsRow }>) {
    const data = row?.data ?? {}
    const conference = conferenceOf(data.conference)
    const seed = Number(data.position)
    const name = String(data.teamName ?? "").trim()
    if (!conference || !name || !Number.isFinite(seed) || seed <= 0) continue
    const bucket = seeds.get(conference) ?? new Map<number, string>()
    /*
     * First write wins, and a collision is reported rather than silently
     * resolved: two clubs claiming one seed means the standings feed is
     * inconsistent, and picking one at random would hide that.
     */
    if (bucket.has(seed)) {
      warnings.push(`duplicate seed ${conference}${seed}: kept "${bucket.get(seed)}", ignored "${name}"`)
      continue
    }
    bucket.set(seed, name)
    seeds.set(conference, bucket)
  }

  if (rows.length === 0) {
    warnings.push(`no standings rows cached under "${prefix}" — has import-standings run for ${sport}?`)
  }

  return { sport, season, seeds, rowsRead: rows.length, warnings }
}

export type ApplyPlayoffSeedsSweep = {
  challengesSeeded: number
  slotsFilled: number
  picksMigrated: number
  slotsUnresolved: number
  warnings: string[]
  errors: string[]
}

/**
 * Seed a set of challenges, resolving each (sport, season) field once.
 *
 * ⚠ THE MEMOISATION IS NOT MICRO-OPTIMISATION. `resolvePlayoffSeedField` does a
 * `startsWith` scan of `SportsDataCache`, which is 3,708 rows / 74 MB today and
 * only grows. Resolving per challenge would repeat that scan up to fifty times
 * per cron fire to read the same thirty rows.
 *
 * Per-challenge failures are collected, not thrown: one pool with a broken
 * bracket must not cost every other pool its field.
 */
export async function applyPlayoffSeedsToChallenges(challengeIds: string[]): Promise<ApplyPlayoffSeedsSweep> {
  const sweep: ApplyPlayoffSeedsSweep = {
    challengesSeeded: 0,
    slotsFilled: 0,
    picksMigrated: 0,
    slotsUnresolved: 0,
    warnings: [],
    errors: [],
  }
  if (challengeIds.length === 0) return sweep

  const challenges = await (prisma as any).playoffBracketChallenge.findMany({
    where: { id: { in: challengeIds } },
    select: { id: true, sport: true, seasonYear: true },
  })

  const fields = new Map<string, PlayoffSeedField>()
  for (const challenge of challenges as Array<{ id: string; sport: string; seasonYear: number }>) {
    const sport = String(challenge.sport ?? "").toLowerCase() as PlayoffSport
    const key = `${sport}:${challenge.seasonYear}`
    try {
      let field = fields.get(key)
      if (!field) {
        field = await resolvePlayoffSeedField(sport, challenge.seasonYear)
        fields.set(key, field)
        // Field-level warnings belong to the field, not to each challenge using it.
        sweep.warnings.push(...field.warnings.map((warning) => `${key}: ${warning}`))
      }
      const result = await applyPlayoffSeedsToChallenge({
        challengeId: challenge.id,
        field: { ...field, warnings: [] },
      })
      if (result.slotsFilled > 0) sweep.challengesSeeded += 1
      sweep.slotsFilled += result.slotsFilled
      sweep.picksMigrated += result.picksMigrated
      sweep.slotsUnresolved += result.slotsUnresolved
    } catch (error) {
      sweep.errors.push(`${challenge.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return sweep
}

export type ApplyPlayoffSeedsResult = {
  challengeId: string
  sport: string
  season: string
  /** Seed slots replaced with a real club name. */
  slotsFilled: number
  /** Picks rewritten so they still name a team in their series. */
  picksMigrated: number
  /** Slots still holding a placeholder because no club was found for that seed. */
  slotsUnresolved: number
  rowsRead: number
  warnings: string[]
}

/**
 * Replace seed placeholders on one challenge's series with real club names.
 *
 * 🛑 RENAMING A SLOT REWRITES PICKS THAT NAMED IT, IN THE SAME TRANSACTION.
 * `PlayoffBracketPick.pickTeamName` is a plain string, and scoring compares it
 * to `winnerTeamName` by value. Rename `AL1` to `Tampa Bay Rays` without
 * touching picks and every pick of `AL1` stops matching either team in its
 * series: it is not wrong, it is unscoreable, and nothing type-checks or
 * tests it. So the rename and the pick migration are one transaction or
 * neither happens.
 *
 * ⚠ Idempotent by construction: a slot that no longer matches
 * `SEED_PLACEHOLDER` is skipped, so a second run is a no-op.
 */
export async function applyPlayoffSeedsToChallenge(input: {
  challengeId: string
  field?: PlayoffSeedField
}): Promise<ApplyPlayoffSeedsResult> {
  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: input.challengeId },
    select: { id: true, sport: true, seasonYear: true },
  })
  if (!challenge) throw new Error("Challenge not found")

  const sport = String(challenge.sport ?? "").toLowerCase() as PlayoffSport
  const field = input.field ?? (await resolvePlayoffSeedField(sport, challenge.seasonYear))
  const warnings = [...field.warnings]

  const series = await (prisma as any).playoffBracketSeries.findMany({
    where: { challengeId: challenge.id },
    select: {
      id: true,
      conference: true,
      homeSeed: true,
      awaySeed: true,
      homeTeamName: true,
      awayTeamName: true,
    },
  })

  type Rename = { seriesId: string; column: "homeTeamName" | "awayTeamName"; from: string; to: string }
  const renames: Rename[] = []
  let slotsUnresolved = 0

  for (const row of series as Array<Record<string, any>>) {
    const conference = String(row.conference ?? "").toLowerCase()
    for (const [column, seedKey] of [
      ["homeTeamName", "homeSeed"],
      ["awayTeamName", "awaySeed"],
    ] as const) {
      const current = String(row[column] ?? "")
      const match = SEED_PLACEHOLDER.exec(current)
      if (!match) continue
      const seed = Number(row[seedKey])
      if (!Number.isFinite(seed) || seed <= 0) continue
      /*
       * The placeholder carries its own conference ("AL1"), and so does the
       * row. They should agree; where they do not the ROW wins, because the
       * row is what the bracket is actually built from.
       */
      const club = field.seeds.get(conference)?.get(seed)
      if (!club) {
        slotsUnresolved += 1
        continue
      }
      renames.push({ seriesId: row.id, column, from: current, to: club })
    }
  }

  if (renames.length === 0) {
    return {
      challengeId: challenge.id,
      sport: String(challenge.sport),
      season: field.season,
      slotsFilled: 0,
      picksMigrated: 0,
      slotsUnresolved,
      rowsRead: field.rowsRead,
      warnings,
    }
  }

  const picksMigrated = await prisma.$transaction(async (tx) => {
    let migrated = 0
    for (const rename of renames) {
      await (tx as any).playoffBracketSeries.update({
        where: { id: rename.seriesId },
        data: { [rename.column]: rename.to },
      })
      /*
       * Scoped to the SERIES, not the challenge: the same placeholder string
       * can legitimately appear in more than one series (an `AL1` slot exists
       * once per round), and a pick only ever refers to its own series.
       */
      const updated = await (tx as any).playoffBracketPick.updateMany({
        where: { seriesId: rename.seriesId, pickTeamName: rename.from },
        data: { pickTeamName: rename.to },
      })
      migrated += updated.count ?? 0
    }
    return migrated
  })

  return {
    challengeId: challenge.id,
    sport: String(challenge.sport),
    season: field.season,
    slotsFilled: renames.length,
    picksMigrated,
    slotsUnresolved,
    rowsRead: field.rowsRead,
    warnings,
  }
}
