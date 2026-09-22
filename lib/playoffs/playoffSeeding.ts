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
  /**
   * False while the regular season is still being played, and therefore while
   * the field can still change. Nothing may be written from a field that is
   * not final — see REGULAR_SEASON_GAMES.
   */
  isFinal: boolean
  /** Fewest games played by any club in the standings, or null if unknown. */
  minGamesPlayed: number | null
  warnings: string[]
}

type StandingsRow = {
  team?: unknown
  teamName?: unknown
  position?: unknown
  conference?: unknown
  won?: unknown
  lost?: unknown
  tied?: unknown
  otLost?: unknown
}

/**
 * Regular-season length per sport, used only to answer "is the field final?".
 *
 * 🛑 SEEDING A PROVISIONAL FIELD IS UNRECOVERABLE, WHICH IS WHY THIS EXISTS.
 * `applyPlayoffSeedsToChallenge` only replaces PLACEHOLDERS and is idempotent
 * — both deliberate — so once `AL6` has been written as a real club it is never
 * revisited. Seed a week early and the bracket keeps whichever club happened to
 * hold the last wild card that day, silently, forever.
 *
 * Measured 2026-09-19: MLB clubs had played 153-155 of 162, and the AL 6th seed
 * led the 7th by two wins. A pool seeded that day would very likely have been
 * wrong, and nothing downstream would ever have corrected it.
 */
const REGULAR_SEASON_GAMES: Record<string, number> = {
  mlb: 162,
  nba: 82,
  nhl: 82,
}

/**
 * ⚠ THE TOLERANCE IS NOT SLOP, IT IS RAINOUTS. MLB cancels late-season games
 * that cannot affect the standings, so a completed season legitimately shows
 * some clubs at 160 or 161. Requiring a hard 162 would mean never seeding in
 * those years. Two games is enough for that and far too small to admit the
 * nine-games-remaining case above.
 */
const SEASON_COMPLETE_TOLERANCE = 2

function conferenceOf(group: unknown): string | null {
  const value = String(group ?? "").trim()
  if (!value) return null
  return CONFERENCE_FROM_GROUP.find((entry) => entry.match.test(value))?.conference ?? null
}

/**
 * The standings season (START year) an NBA/NHL challenge is for.
 *
 * 🛑 ONE EXACT KEY, DERIVED — NEVER "whichever key exists". Standings rows are never purged and a
 * finished season reads `isFinal`, while seed writes are permanent. Every existence-based rule
 * tried here reached last season's final rows in some window: "year-1 first" for pools made
 * Oct-Dec, "own year first, then year-1" for pools made Jul-Oct before the new season's first
 * standings write. Only WHEN the pool was made says which season it is for, because
 * `seasonYear` defaults to the calendar year and so means 2025-26 in spring 2026 and 2026-27 in
 * autumn 2026. If the season's key does not exist yet, the answer is "wait", not "use the last one".
 *
 * `seasonYear` is honoured when it is either label of that season (start year, or the playoff
 * calendar year). Any other explicit year is read as a playoff calendar year.
 */
export function splitYearSeasonStart(seasonYear: number, createdAt: Date | null | undefined): number {
  const created = createdAt instanceof Date && Number.isFinite(createdAt.getTime()) ? createdAt : null
  if (!created) return seasonYear - 1
  // July onward belongs to the season that starts that autumn — the same cutoff the writer uses.
  const start = created.getUTCMonth() >= 6 ? created.getUTCFullYear() : created.getUTCFullYear() - 1
  if (seasonYear === start || seasonYear === start + 1) return start
  return seasonYear - 1
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
  createdAt?: Date | null,
): Promise<PlayoffSeedField> {
  const warnings: string[] = []

  // NBA/NHL are keyed by season START year; see splitYearSeasonStart for why it is derived.
  const season =
    sport === "nba" || sport === "nhl"
      ? String(splitYearSeasonStart(Number(seasonYear), createdAt))
      : String(seasonYear)
  const prefix = `${sport.toUpperCase()}:standings:${season}:`
  const rows = await (prisma.sportsDataCache as any).findMany({
    where: { cacheKey: { startsWith: prefix } },
    select: { data: true },
  })

  const seeds = new Map<string, Map<number, string>>()
  const gamesPlayed: number[] = []
  for (const row of rows as Array<{ data: StandingsRow }>) {
    const data = row?.data ?? {}
    const conference = conferenceOf(data.conference)
    const seed = Number(data.position)
    const name = String(data.teamName ?? "").trim()
    /*
     * Counted across EVERY row, not only the seeded field: whether the season
     * is over is a fact about the league, and the clubs eliminated from the
     * field are exactly the ones whose last games get cancelled.
     */
    const won = Number(data.won)
    const lost = Number(data.lost)
    /*
     * ⚠ NHL OVERTIME LOSSES ARE A SEPARATE COLUMN (`otLost`), not part of `lost`. Counting only
     * won + lost put every NHL club ~8-15 games short of the 82-game season, so the field could
     * never read as final and NHL pools would never seed. Ties/OT losses absent means zero.
     */
    const extra = (Number(data.tied) || 0) + (Number(data.otLost) || 0)
    if (Number.isFinite(won) && Number.isFinite(lost)) gamesPlayed.push(won + lost + extra)
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

  const minGamesPlayed = gamesPlayed.length > 0 ? Math.min(...gamesPlayed) : null
  const required = REGULAR_SEASON_GAMES[String(sport).toLowerCase()]
  /*
   * ⚠ UNKNOWN IS NOT FINAL. A sport with no entry here, or standings carrying
   * no win/loss figures, cannot be shown to be over — and the failure of
   * seeding too early is permanent, so the unknown case must refuse. A sport
   * is added to REGULAR_SEASON_GAMES deliberately, never by defaulting.
   */
  const isFinal =
    required != null && minGamesPlayed != null && minGamesPlayed >= required - SEASON_COMPLETE_TOLERANCE

  if (!isFinal && rows.length > 0) {
    warnings.push(
      required == null
        ? `no regular-season length known for ${sport}; refusing to treat the field as final`
        : `field not final: fewest games played is ${minGamesPlayed ?? "unknown"} of ${required}`,
    )
  }

  return { sport, season, seeds, rowsRead: rows.length, isFinal, minGamesPlayed, warnings }
}

export type ApplyPlayoffSeedsSweep = {
  challengesSeeded: number
  slotsFilled: number
  picksMigrated: number
  slotsUnresolved: number
  /** Challenges left untouched because their field is not final yet. */
  skippedFieldNotFinal: number
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
    skippedFieldNotFinal: 0,
    warnings: [],
    errors: [],
  }
  if (challengeIds.length === 0) return sweep

  const challenges = await (prisma as any).playoffBracketChallenge.findMany({
    where: { id: { in: challengeIds } },
    select: { id: true, sport: true, seasonYear: true, createdAt: true },
  })

  const fields = new Map<string, PlayoffSeedField>()
  for (const challenge of challenges as Array<{ id: string; sport: string; seasonYear: number; createdAt?: Date | null }>) {
    const sport = String(challenge.sport ?? "").toLowerCase() as PlayoffSport
    // Keyed by the RESOLVED season: two NBA challenges sharing a seasonYear can be for different seasons.
    const season =
      sport === "nba" || sport === "nhl"
        ? splitYearSeasonStart(challenge.seasonYear, challenge.createdAt)
        : challenge.seasonYear
    const key = `${sport}:${season}`
    try {
      let field = fields.get(key)
      if (!field) {
        field = await resolvePlayoffSeedField(sport, challenge.seasonYear, challenge.createdAt)
        fields.set(key, field)
        // Field-level warnings belong to the field, not to each challenge using it.
        sweep.warnings.push(...field.warnings.map((warning) => `${key}: ${warning}`))
      }
      const result = await applyPlayoffSeedsToChallenge({
        challengeId: challenge.id,
        field: { ...field, warnings: [] },
      })
      if (result.skippedFieldNotFinal) sweep.skippedFieldNotFinal += 1
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
  /** True when nothing was written because the regular season is still running. */
  skippedFieldNotFinal: boolean
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
    select: { id: true, sport: true, seasonYear: true, createdAt: true },
  })
  if (!challenge) throw new Error("Challenge not found")

  const sport = String(challenge.sport ?? "").toLowerCase() as PlayoffSport
  const field = input.field ?? (await resolvePlayoffSeedField(sport, challenge.seasonYear, challenge.createdAt))
  const warnings = [...field.warnings]

  /*
   * 🛑 REFUSE BEFORE WRITING ANYTHING. This is the one check that cannot be
   * deferred to "we will re-run it later": the write is idempotent and only
   * touches placeholders, so a club written from a provisional field is
   * permanent. Better an unseeded bracket than a confidently wrong one.
   */
  if (!field.isFinal) {
    return {
      challengeId: challenge.id,
      sport: String(challenge.sport),
      season: field.season,
      slotsFilled: 0,
      picksMigrated: 0,
      slotsUnresolved: 0,
      rowsRead: field.rowsRead,
      skippedFieldNotFinal: true,
      warnings,
    }
  }

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
      skippedFieldNotFinal: false,
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
    skippedFieldNotFinal: false,
    warnings,
  }
}
