import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CLASS_MODEL_VERSION, type ClassifiedRating, type RatingEvent } from '@/lib/class-rating/engine'
import type { FactRow, LeagueMeta } from '@/lib/class-rating/inputs'

/**
 * Class rating persistence — `manager_ratings` and `manager_rating_events` (ADR F2.10a).
 *
 * ⚠ RAW SQL ON PURPOSE. These tables are written in bulk (~140k game-log rows on a full
 * rebuild), which wants `INSERT … SELECT unnest(…)` in chunks, and read with joins the
 * generated client cannot express. Every statement names its columns, so a schema change
 * that renames one fails loudly here rather than writing the wrong field.
 *
 * ⚠ EVERY ENTRY POINT ASKS `classTablesReady()` FIRST. The code may run against a database
 * the migration has not reached (a fresh branch, staging), and a missing table must read as
 * "nothing rated yet", never as an error page.
 */

export const CLASS_SPORT = 'NFL'
const STATE_KEY = 'class-rating:state:v1'
const STATE_TTL_DAYS = 400
const EVENT_CHUNK = 5000

export async function classTablesReady(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT (to_regclass('public.manager_ratings') IS NOT NULL
        AND to_regclass('public.manager_rating_events') IS NOT NULL) AS ok`.catch(() => [{ ok: false }])
  return rows[0]?.ok === true
}

/** Every NFL matchup fact with both sides' platform identity and claiming account. */
export async function loadFactRows(): Promise<FactRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      leagueId: string
      platform: string
      platformLeagueId: string
      season: number
      week: number
      ua: string | null
      ub: string | null
      ca: string | null
      cb: string | null
      sa: number
      sb: number
      winner: string | null
    }>
  >`
    SELECT f."leagueId", l.platform, l."platformLeagueId", f.season, f."weekOrPeriod" AS week,
           ta."platformUserId" AS ua, tb."platformUserId" AS ub,
           ta."claimedByUserId" AS ca, tb."claimedByUserId" AS cb,
           f."scoreA" AS sa, f."scoreB" AS sb, f."winnerTeamId" AS winner
      FROM dw_matchup_facts f
      JOIN leagues l ON l.id = f."leagueId"
      LEFT JOIN league_teams ta ON ta."leagueId" = f."leagueId" AND ta."externalId" = f."teamA"
      LEFT JOIN league_teams tb ON tb."leagueId" = f."leagueId" AND tb."externalId" = f."teamB"
     WHERE f.sport = ${CLASS_SPORT} AND f.season IS NOT NULL`
  return rows.map((r) => ({
    leagueId: r.leagueId,
    platform: String(r.platform).toLowerCase(),
    platformLeagueId: r.platformLeagueId,
    season: Number(r.season),
    week: Number(r.week),
    userA: r.ua,
    userB: r.ub,
    claimA: r.ca,
    claimB: r.cb,
    scoreA: Number(r.sa),
    scoreB: Number(r.sb),
    winnerTeamId: r.winner,
  }))
}

export async function loadLeagueMeta(leagueIds: string[]): Promise<Map<string, LeagueMeta>> {
  const out = new Map<string, LeagueMeta>()
  if (leagueIds.length === 0) return out
  const rows = await prisma.league.findMany({
    where: { id: { in: [...new Set(leagueIds)] } },
    select: { id: true, season: true, settings: true },
  })
  for (const r of rows) out.set(r.id, { leagueId: r.id, season: r.season ?? null, settings: r.settings })
  return out
}

/* ─────────────────────────────── run state ─────────────────────────────── */

export type ClassRatingState = { date: string; inputHash: string; computedAt: string }

export async function readClassRatingState(): Promise<ClassRatingState | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: STATE_KEY }, select: { data: true } })
  const d = row?.data as Partial<ClassRatingState> | undefined
  return d && typeof d.date === 'string' && typeof d.inputHash === 'string' && typeof d.computedAt === 'string'
    ? { date: d.date, inputHash: d.inputHash, computedAt: d.computedAt }
    : null
}

export async function writeClassRatingState(state: ClassRatingState, now: Date = new Date()): Promise<void> {
  const data = state as unknown as Prisma.InputJsonValue
  const expiresAt = new Date(now.getTime() + STATE_TTL_DAYS * 86_400_000)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: STATE_KEY },
    create: { cacheKey: STATE_KEY, data, expiresAt },
    update: { data, expiresAt },
  })
}

/* ──────────────────────────────── the write ──────────────────────────────── */

export type SubjectIdentity = { platform: string; platformUserId: string }

export function identityOf(subjectKey: string): SubjectIdentity {
  const i = subjectKey.indexOf(':')
  return { platform: subjectKey.slice(0, i), platformUserId: subjectKey.slice(i + 1) }
}

/**
 * Replace this model version's ratings and game log, in ONE transaction.
 *
 * ⚠ A FULL REPLACE, NOT AN UPSERT. A rating is a function of the whole history before it, so
 * one corrected week in 2021 changes every later row for everyone in that league's network.
 * Diffing that is more code than the rebuild it saves, and the writer only runs when the
 * input hash changes — about once a week in season.
 *
 * ⚠ ONE TRANSACTION, so a reader sees yesterday's ratings or today's, never half of each.
 */
export async function replaceClassRatings(args: {
  classified: Map<string, ClassifiedRating>
  events: RatingEvent[]
  claimedBy: Map<string, string>
  computedAt: Date
  timeoutMs: number
}): Promise<{ ratings: number; events: number }> {
  const { classified, events, claimedBy, computedAt } = args
  const keys = [...classified.keys()].sort()
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`DELETE FROM manager_rating_events WHERE "modelVersion" = ${CLASS_MODEL_VERSION} AND sport = ${CLASS_SPORT}`
      await tx.$executeRaw`DELETE FROM manager_ratings WHERE "modelVersion" = ${CLASS_MODEL_VERSION} AND sport = ${CLASS_SPORT}`

      for (let i = 0; i < keys.length; i += EVENT_CHUNK) {
        const part = keys.slice(i, i + EVENT_CHUNK)
        const c = part.map((k) => classified.get(k)!)
        const ids = part.map(() => randomUUID())
        const platforms = part.map((k) => identityOf(k).platform)
        const users = part.map((k) => identityOf(k).platformUserId)
        const claims = part.map((k) => claimedBy.get(k) ?? null)
        await tx.$executeRaw`
          INSERT INTO manager_ratings
            ("id", "subjectKey", "platform", "platformUserId", "userId", "sport", "modelVersion",
             "rating", "rd", "volatility", "games", "established", "percentile", "classLevel", "division",
             "lastPeriod", "computedAt", "createdAt", "updatedAt")
          SELECT u.id, u.subject_key, u.platform, u.platform_user_id, u.user_id, ${CLASS_SPORT}, ${CLASS_MODEL_VERSION},
                 u.rating, u.rd, u.volatility, u.games, u.established, u.percentile, u.class_level, u.division,
                 u.last_period, ${computedAt}, ${computedAt}, ${computedAt}
            FROM unnest(
              ${ids}::text[], ${part}::text[], ${platforms}::text[], ${users}::text[], ${claims}::text[],
              ${c.map((x) => x.rating)}::float8[], ${c.map((x) => x.rd)}::float8[], ${c.map((x) => x.volatility)}::float8[],
              ${c.map((x) => x.games)}::int[], ${c.map((x) => x.established)}::boolean[],
              ${c.map((x) => x.percentile)}::float8[], ${c.map((x) => x.classLevel)}::int[], ${c.map((x) => x.division)}::int[],
              ${c.map((x) => x.lastPeriod)}::int[]
            ) AS u(id, subject_key, platform, platform_user_id, user_id, rating, rd, volatility, games, established,
                   percentile, class_level, division, last_period)`
      }

      for (let i = 0; i < events.length; i += EVENT_CHUNK) {
        const e = events.slice(i, i + EVENT_CHUNK)
        await tx.$executeRaw`
          INSERT INTO manager_rating_events
            ("id", "subjectKey", "sport", "modelVersion", "leagueId", "season", "week", "pointsFor",
             "allPlayWins", "allPlayGames", "opponentKey", "pointsAgainst", "result",
             "ratingBefore", "ratingAfter", "rdAfter", "ratingDelta", "createdAt")
          SELECT u.id, u.subject_key, ${CLASS_SPORT}, ${CLASS_MODEL_VERSION}, u.league_id, u.season, u.week, u.points_for,
                 u.ap_wins, u.ap_games, u.opponent_key, u.points_against, u.result,
                 u.rating_before, u.rating_after, u.rd_after, u.rating_delta, ${computedAt}
            FROM unnest(
              ${e.map(() => randomUUID())}::text[], ${e.map((x) => x.subjectKey)}::text[], ${e.map((x) => x.leagueId)}::text[],
              ${e.map((x) => x.season)}::int[], ${e.map((x) => x.week)}::int[], ${e.map((x) => x.pointsFor)}::float8[],
              ${e.map((x) => x.allPlayWins)}::float8[], ${e.map((x) => x.allPlayGames)}::int[],
              ${e.map((x) => x.opponentKey)}::text[], ${e.map((x) => x.pointsAgainst)}::float8[], ${e.map((x) => x.result)}::text[],
              ${e.map((x) => x.ratingBefore)}::float8[], ${e.map((x) => x.ratingAfter)}::float8[],
              ${e.map((x) => x.rdAfter)}::float8[], ${e.map((x) => x.ratingDelta)}::float8[]
            ) AS u(id, subject_key, league_id, season, week, points_for, ap_wins, ap_games, opponent_key,
                   points_against, result, rating_before, rating_after, rd_after, rating_delta)`
      }
      return { ratings: keys.length, events: events.length }
    },
    { timeout: args.timeoutMs, maxWait: 10_000 },
  )
}
