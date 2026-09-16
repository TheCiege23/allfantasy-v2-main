import 'server-only'

import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { isMissingDatabaseObjectError } from '@/lib/canonical/getCanonicalPlayer'

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
export type AdviceSurface = 'start_vs_comparison' | 'chimmy_chat_lineup' | 'chimmy_chat_waiver'

export const ADVICE_TYPES: readonly AdviceType[] = ['start_sit', 'add', 'lineup_swap']
export const ADVICE_SURFACES: readonly AdviceSurface[] = ['start_vs_comparison', 'chimmy_chat_lineup', 'chimmy_chat_waiver']
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
}

export type ChimmyAdvice = Omit<AdviceInput, 'userId'> & { givenAt: Date }

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
