import 'server-only'

import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { isMissingDatabaseObjectError } from '@/lib/canonical/getCanonicalPlayer'
import { MY_TEAM_BENCH_SURFACE } from './adviceSurfaces'

/**
 * Advice Chimmy gave — the storage half of Chimmy receipts (retention item 6, user decisions
 * 2026-09-14). The one place that reads or writes `chimmy_advice`.
 *
 * 🛑 RAW SQL, NOT A PRISMA MODEL, UNTIL THE MIGRATION IS APPLIED. The table is created by
 * `prisma/migrations-pending/20260914230000_chimmy_advice`, whose apply is the user's call. A
 * model before that would raise P2021 against a database without the table and show up as new
 * drift in the schema-drift guard. Same order as `lib/follows/playerFollows.ts`: apply → model →
 * swap these queries for the model in one change.
 *
 * ⚠ A MISSING TABLE IS "UNAVAILABLE", NEVER "NO ADVICE". Reads return `null` for 42P01 so the
 * card hides the section instead of implying Chimmy never said anything; writes report
 * `unavailable`. Any other database error propagates to the caller.
 *
 * ⚠ ONLY WHAT WAS SAID. No outcome is stored — receipts resolve it at read time from the
 * platform's weekly scores, so there is no resolver to schedule and no verdict to go stale.
 */

export type AdviceType = 'start_sit' | 'add' | 'lineup_swap'
export type AdviceSurface =
  | 'start_vs_comparison'
  | 'chimmy_chat_lineup'
  | 'chimmy_chat_waiver'
  | 'triage_swap'
  | 'my_team_bench'

// `triage_swap` and `my_team_bench` are AllFantasy's calls, not Chimmy's — see ./adviceSurfaces.ts.
export { AF_TIP_SURFACE, MY_TEAM_BENCH_SURFACE, isChimmyAdvice } from './adviceSurfaces'

export const ADVICE_TYPES: readonly AdviceType[] = ['start_sit', 'add', 'lineup_swap']
export const ADVICE_SURFACES: readonly AdviceSurface[] = [
  'start_vs_comparison',
  'chimmy_chat_lineup',
  'chimmy_chat_waiver',
  'triage_swap',
  'my_team_bench',
]
export const MAX_ADVICE_READ = 200

export type AdviceInput = {
  userId: string
  leagueId: string
  sport: string
  season: number
  week: number
  adviceType: AdviceType
  surface: AdviceSurface
  rec: { key: string; name: string }
  /** The player the advice was OVER. Null for an add. */
  alt: { key: string; name: string } | null
  slot: string | null
  confidencePct: number | null
  /**
   * The advice ledger (2026-11-14): each player's projection when the call was made. Written to
   * `rec_projected` / `alt_projected` once `20261115000000_chimmy_advice_ledger_inputs` is applied;
   * before that the insert falls back to the original columns and the call is still recorded.
   */
  projected?: { rec: number | null; alt: number | null } | null
}

export type ChimmyAdvice = Omit<AdviceInput, 'userId' | 'projected'> & { givenAt: Date }

export type RecordAdviceResult = 'recorded' | 'unavailable' | 'invalid'

const validWeek = (n: number) => Number.isInteger(n) && n >= 1 && n <= 25
const validSeason = (n: number) => Number.isInteger(n) && n >= 2000 && n <= 2100

/**
 * Record one piece of advice. Asking again for the same week, league and pair refreshes the
 * confidence, slot and time rather than adding a second row — the receipt is about the advice,
 * not how many times it was asked.
 */
export async function recordAdvice(input: AdviceInput): Promise<RecordAdviceResult> {
  const recKey = input.rec?.key?.trim()
  const recName = input.rec?.name?.trim()
  const altKey = input.alt?.key?.trim() ?? ''
  if (
    !input.userId ||
    !input.leagueId ||
    !recKey ||
    !recName ||
    !ADVICE_TYPES.includes(input.adviceType) ||
    !ADVICE_SURFACES.includes(input.surface) ||
    !validSeason(input.season) ||
    !validWeek(input.week) ||
    (input.adviceType !== 'add' && !altKey) ||
    altKey === recKey
  ) {
    return 'invalid'
  }
  const confidence =
    input.confidencePct != null && Number.isFinite(input.confidencePct)
      ? Math.max(0, Math.min(100, Math.round(input.confidencePct)))
      : null

  /*
   * 🛑 MY TEAM NEVER TAKES OVER ANOTHER SURFACE'S ROW. The row is unique per (user, league, week,
   * type, pair) and the original upsert rewrites `surface` — fine between two Chimmy surfaces, but My
   * Team's bench check re-renders on every page view, so the same "start X over Y" from Chimmy would be
   * relabelled My Team's and drop out of Chimmy's track record. Its upsert is scoped to its own rows
   * (`DO UPDATE … WHERE surface = 'my_team_bench'`), and a Chimmy call on the same pair still takes
   * the row, as Chimmy's.
   */
  const ownRowsOnly = input.surface === MY_TEAM_BENCH_SURFACE
  const recProjected = finiteOrNull(input.projected?.rec)
  const altProjected = finiteOrNull(input.projected?.alt)
  if (ownRowsOnly || input.projected) {
    try {
      if (ownRowsOnly) {
        await prisma.$executeRaw`
          INSERT INTO "chimmy_advice"
            ("id", "user_id", "league_id", "sport", "season", "week", "advice_type", "surface",
             "rec_player_key", "rec_name", "alt_player_key", "alt_name", "slot", "confidence_pct",
             "rec_projected", "alt_projected")
          VALUES
            (${randomUUID()}, ${input.userId}, ${input.leagueId}, ${String(input.sport ?? '').trim().toUpperCase()},
             ${input.season}, ${input.week}, ${input.adviceType}, ${input.surface},
             ${recKey}, ${recName}, ${altKey}, ${input.alt?.name?.trim() || null}, ${input.slot?.trim() || null}, ${confidence},
             ${recProjected}, ${altProjected})
          ON CONFLICT ("user_id", "league_id", "season", "week", "advice_type", "rec_player_key", "alt_player_key") DO UPDATE SET
            "rec_name"       = EXCLUDED."rec_name",
            "alt_name"       = EXCLUDED."alt_name",
            "slot"           = EXCLUDED."slot",
            "confidence_pct" = EXCLUDED."confidence_pct",
            "rec_projected"  = EXCLUDED."rec_projected",
            "alt_projected"  = EXCLUDED."alt_projected",
            "withdrawn_at"   = NULL,
            "given_at"       = CURRENT_TIMESTAMP
          WHERE "chimmy_advice"."surface" = ${MY_TEAM_BENCH_SURFACE}
        `
      } else {
        await prisma.$executeRaw`
          INSERT INTO "chimmy_advice"
            ("id", "user_id", "league_id", "sport", "season", "week", "advice_type", "surface",
             "rec_player_key", "rec_name", "alt_player_key", "alt_name", "slot", "confidence_pct",
             "rec_projected", "alt_projected")
          VALUES
            (${randomUUID()}, ${input.userId}, ${input.leagueId}, ${String(input.sport ?? '').trim().toUpperCase()},
             ${input.season}, ${input.week}, ${input.adviceType}, ${input.surface},
             ${recKey}, ${recName}, ${altKey}, ${input.alt?.name?.trim() || null}, ${input.slot?.trim() || null}, ${confidence},
             ${recProjected}, ${altProjected})
          ON CONFLICT ("user_id", "league_id", "season", "week", "advice_type", "rec_player_key", "alt_player_key") DO UPDATE SET
            "surface"        = EXCLUDED."surface",
            "rec_name"       = EXCLUDED."rec_name",
            "alt_name"       = EXCLUDED."alt_name",
            "slot"           = EXCLUDED."slot",
            "confidence_pct" = EXCLUDED."confidence_pct",
            "rec_projected"  = EXCLUDED."rec_projected",
            "alt_projected"  = EXCLUDED."alt_projected",
            "withdrawn_at"   = NULL,
            "given_at"       = CURRENT_TIMESTAMP
        `
      }
      return 'recorded'
    } catch (err) {
      // The ledger columns are not migrated yet: record the call the original way below.
      if (!isUndefinedColumnError(err)) {
        if (isMissingDatabaseObjectError(err)) return 'unavailable'
        throw err
      }
    }
    if (ownRowsOnly) {
      // Unmigrated fallback for My Team: insert once, never touch an existing row (see above).
      try {
        await prisma.$executeRaw`
          INSERT INTO "chimmy_advice"
            ("id", "user_id", "league_id", "sport", "season", "week", "advice_type", "surface",
             "rec_player_key", "rec_name", "alt_player_key", "alt_name", "slot", "confidence_pct")
          VALUES
            (${randomUUID()}, ${input.userId}, ${input.leagueId}, ${String(input.sport ?? '').trim().toUpperCase()},
             ${input.season}, ${input.week}, ${input.adviceType}, ${input.surface},
             ${recKey}, ${recName}, ${altKey}, ${input.alt?.name?.trim() || null}, ${input.slot?.trim() || null}, ${confidence})
          ON CONFLICT ("user_id", "league_id", "season", "week", "advice_type", "rec_player_key", "alt_player_key") DO NOTHING
        `
        return 'recorded'
      } catch (err) {
        if (isMissingDatabaseObjectError(err)) return 'unavailable'
        throw err
      }
    }
  }
  try {
    await prisma.$executeRaw`
      INSERT INTO "chimmy_advice"
        ("id", "user_id", "league_id", "sport", "season", "week", "advice_type", "surface",
         "rec_player_key", "rec_name", "alt_player_key", "alt_name", "slot", "confidence_pct")
      VALUES
        (${randomUUID()}, ${input.userId}, ${input.leagueId}, ${String(input.sport ?? '').trim().toUpperCase()},
         ${input.season}, ${input.week}, ${input.adviceType}, ${input.surface},
         ${recKey}, ${recName}, ${altKey}, ${input.alt?.name?.trim() || null}, ${input.slot?.trim() || null}, ${confidence})
      ON CONFLICT ("user_id", "league_id", "season", "week", "advice_type", "rec_player_key", "alt_player_key") DO UPDATE SET
        "surface"        = EXCLUDED."surface",
        "rec_name"       = EXCLUDED."rec_name",
        "alt_name"       = EXCLUDED."alt_name",
        "slot"           = EXCLUDED."slot",
        "confidence_pct" = EXCLUDED."confidence_pct",
        "given_at"       = CURRENT_TIMESTAMP
    `
    return 'recorded'
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return 'unavailable'
    throw err
  }
}

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Postgres 42703 — a column the query names does not exist (the ledger migration is not applied). */
function isUndefinedColumnError(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown } } | null | undefined
  return e?.code === '42703' || e?.code === 'P2022' || e?.meta?.code === '42703'
}

/**
 * Mark My Team's calls for a week that it no longer makes as WITHDRAWN — but only calls whose two
 * players have NOT kicked off (`openPlayerKeys`). After a kickoff the bench check stops offering a
 * swap because the game started, not because the advice changed, and that call stands.
 *
 * Returns how many were withdrawn, or 'unavailable' before the ledger migration is applied.
 */
export async function withdrawStaleMyTeamAdvice(args: {
  userId: string
  leagueId: string
  season: number
  week: number
  /** The calls made on this render, as rec/alt player keys. */
  keep: ReadonlyArray<{ rec: string; alt: string }>
  /** Players on the roster whose games have not started. */
  openPlayerKeys: readonly string[]
}): Promise<number | 'unavailable'> {
  const open = [...new Set(args.openPlayerKeys.map((k) => String(k).trim()).filter(Boolean))]
  if (!args.userId || !args.leagueId || open.length === 0) return 0
  const keep = args.keep.map((k) => `${k.rec}>${k.alt}`)
  try {
    return await prisma.$executeRaw`
      UPDATE "chimmy_advice" SET "withdrawn_at" = CURRENT_TIMESTAMP
      WHERE "user_id" = ${args.userId}
        AND "league_id" = ${args.leagueId}
        AND "season" = ${args.season}
        AND "week" = ${args.week}
        AND "surface" = ${MY_TEAM_BENCH_SURFACE}
        AND "advice_type" = 'start_sit'
        AND "withdrawn_at" IS NULL
        AND "rec_player_key" = ANY(${open}::text[])
        AND "alt_player_key" = ANY(${open}::text[])
        AND NOT (("rec_player_key" || '>' || "alt_player_key") = ANY(${keep}::text[]))
    `
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return 'unavailable'
    throw err
  }
}

/**
 * Everyone who was given advice since a date, with the leagues it was for — most recently advised
 * first. The outcome loop's work list. `null` when advice is unavailable.
 */
export async function listAdviceUsers(args: {
  since: Date
  limit: number
}): Promise<Array<{ userId: string; leagueIds: string[] }> | null> {
  const limit = Math.max(1, Math.floor(args.limit))
  try {
    const rows = await prisma.$queryRaw<Array<{ user_id: string; league_ids: string[] }>>`
      SELECT "user_id", array_agg(DISTINCT "league_id") AS "league_ids"
      FROM "chimmy_advice"
      WHERE "given_at" >= ${args.since}
        AND "surface" <> ${MY_TEAM_BENCH_SURFACE}
      GROUP BY "user_id"
      ORDER BY MAX("given_at") DESC
      LIMIT ${limit}
    `
    return rows.map((r) => ({ userId: r.user_id, leagueIds: Array.isArray(r.league_ids) ? r.league_ids.map(String) : [] }))
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return null
    throw err
  }
}

type AdviceRow = {
  league_id: string
  sport: string
  season: number
  week: number
  advice_type: string
  surface: string
  rec_player_key: string
  rec_name: string
  alt_player_key: string
  alt_name: string | null
  slot: string | null
  confidence_pct: number | null
  given_at: Date
}

/**
 * A user's advice in the given leagues since a date, newest first. `null` when advice is
 * unavailable (the table does not exist yet).
 */
export async function listAdviceForUser(args: {
  userId: string
  leagueIds: readonly string[]
  since: Date
  limit?: number
}): Promise<ChimmyAdvice[] | null> {
  if (!args.userId || args.leagueIds.length === 0) return []
  const limit = Math.max(1, Math.min(args.limit ?? MAX_ADVICE_READ, MAX_ADVICE_READ))
  try {
    const rows = await prisma.$queryRaw<AdviceRow[]>`
      SELECT "league_id", "sport", "season", "week", "advice_type", "surface", "rec_player_key", "rec_name",
             "alt_player_key", "alt_name", "slot", "confidence_pct", "given_at"
      FROM "chimmy_advice"
      WHERE "user_id" = ${args.userId}
        AND "league_id" = ANY(${[...args.leagueIds]}::text[])
        AND "given_at" >= ${args.since}
        AND "surface" <> ${MY_TEAM_BENCH_SURFACE}
      ORDER BY "given_at" DESC
      LIMIT ${limit}
    `
    return rows
      .filter(
        (r) =>
          ADVICE_TYPES.includes(r.advice_type as AdviceType) && ADVICE_SURFACES.includes(r.surface as AdviceSurface),
      )
      .map((r) => ({
        leagueId: r.league_id,
        sport: r.sport,
        season: Number(r.season),
        week: Number(r.week),
        adviceType: r.advice_type as AdviceType,
        surface: r.surface as AdviceSurface,
        rec: { key: r.rec_player_key, name: r.rec_name },
        alt: r.alt_player_key ? { key: r.alt_player_key, name: r.alt_name ?? '' } : null,
        slot: r.slot,
        confidencePct: r.confidence_pct == null ? null : Number(r.confidence_pct),
        givenAt: r.given_at,
      }))
  } catch (err) {
    if (isMissingDatabaseObjectError(err)) return null
    throw err
  }
}
