import { prisma } from '@/lib/prisma'
import { CLASS_MODEL_VERSION, GLICKO } from '@/lib/class-rating/engine'
import { CLASS_SPORT, classTablesReady } from '@/lib/class-rating/store'

/**
 * Reading a user's Class and game log — what surfaces call (ADR F2.10a).
 *
 * ⚠ "UNRATED" IS A STATE, NOT CLASS 1 (F2.10 policy 1). No row, no table, or a person with
 * no matchup facts all return `{ status: 'unrated' }`, and a surface must say so.
 *
 * ⚠ THE UNCERTAINTY TRAVELS WITH THE NUMBER (F2.10a rule 5). A provisional rating has no
 * Class and no division, only a rating and its deviation; there is no shape of this result
 * from which a surface can print a Class without knowing whether it is established.
 *
 * ⚠ ONE AF ACCOUNT CAN BE SEVERAL RATED PEOPLE — a Sleeper identity and an ESPN one. The
 * established rating with the most games represents the account.
 */

export type ManagerClass =
  | { status: 'unrated' }
  | {
      status: 'provisional'
      rating: number
      rd: number
      games: number
      /** RD at which the rating becomes established. */
      establishedAtRd: number
      computedAt: string
    }
  | {
      status: 'established'
      rating: number
      rd: number
      games: number
      classLevel: number
      division: number
      percentile: number
      computedAt: string
    }

type RatingRow = {
  subjectKey: string
  rating: number
  rd: number
  games: number
  established: boolean
  percentile: number | null
  classLevel: number | null
  division: number | null
  computedAt: Date
}

async function bestRatingRow(userId: string): Promise<RatingRow | null> {
  const rows = await prisma.$queryRaw<RatingRow[]>`
    SELECT "subjectKey", rating, rd, games, established, percentile, "classLevel", division, "computedAt"
      FROM manager_ratings
     WHERE "userId" = ${userId} AND sport = ${CLASS_SPORT} AND "modelVersion" = ${CLASS_MODEL_VERSION}
     ORDER BY established DESC, games DESC, "subjectKey" ASC
     LIMIT 1`
  return rows[0] ?? null
}

export function toManagerClass(row: RatingRow | null): ManagerClass {
  if (!row) return { status: 'unrated' }
  const computedAt = row.computedAt.toISOString()
  if (row.established && row.classLevel != null && row.division != null && row.percentile != null) {
    return {
      status: 'established',
      rating: row.rating,
      rd: row.rd,
      games: row.games,
      classLevel: row.classLevel,
      division: row.division,
      percentile: row.percentile,
      computedAt,
    }
  }
  return { status: 'provisional', rating: row.rating, rd: row.rd, games: row.games, establishedAtRd: GLICKO.establishedRd, computedAt }
}

export async function getManagerClass(userId: string | null | undefined): Promise<ManagerClass> {
  if (!userId) return { status: 'unrated' }
  try {
    if (!(await classTablesReady())) return { status: 'unrated' }
    return toManagerClass(await bestRatingRow(userId))
  } catch (e) {
    console.warn('[class-rating] read failed:', e instanceof Error ? e.message : e)
    return { status: 'unrated' }
  }
}

export type GameLogEntry = {
  leagueId: string
  leagueName: string | null
  season: number
  week: number
  pointsFor: number
  allPlayWins: number
  allPlayGames: number
  result: 'W' | 'L' | 'T' | null
  pointsAgainst: number | null
  /** The opponent's CURRENT Class — not the Class they held that week, which is not stored. */
  opponentClassNow: number | null
  ratingBefore: number
  ratingAfter: number
  ratingDelta: number
}

/** The user's game log, newest week first. Empty when unrated. */
export async function getClassGameLog(userId: string | null | undefined, limit = 20): Promise<GameLogEntry[]> {
  if (!userId) return []
  const take = Math.max(1, Math.min(200, Math.floor(limit)))
  try {
    if (!(await classTablesReady())) return []
    const best = await bestRatingRow(userId)
    if (!best) return []
    const rows = await prisma.$queryRaw<
      Array<Omit<GameLogEntry, 'result'> & { result: string | null }>
    >`
      SELECT e."leagueId", l.name AS "leagueName", e.season, e.week, e."pointsFor",
             e."allPlayWins", e."allPlayGames", e.result, e."pointsAgainst",
             o."classLevel" AS "opponentClassNow",
             e."ratingBefore", e."ratingAfter", e."ratingDelta"
        FROM manager_rating_events e
        LEFT JOIN leagues l ON l.id = e."leagueId"
        LEFT JOIN manager_ratings o
               ON o."subjectKey" = e."opponentKey" AND o.sport = e.sport AND o."modelVersion" = e."modelVersion"
       WHERE e."subjectKey" = ${best.subjectKey} AND e.sport = ${CLASS_SPORT} AND e."modelVersion" = ${CLASS_MODEL_VERSION}
       ORDER BY e.season DESC, e.week DESC, e."leagueId" ASC
       LIMIT ${take}`
    return rows.map((r) => ({
      ...r,
      season: Number(r.season),
      week: Number(r.week),
      allPlayGames: Number(r.allPlayGames),
      opponentClassNow: r.opponentClassNow == null ? null : Number(r.opponentClassNow),
      result: r.result === 'W' || r.result === 'L' || r.result === 'T' ? r.result : null,
    }))
  } catch (e) {
    console.warn('[class-rating] game log read failed:', e instanceof Error ? e.message : e)
    return []
  }
}

/**
 * Class division per AF account, ESTABLISHED ratings only — anyone unrated or provisional is simply
 * absent. For surfaces that need a person's weight class and nothing else: the Community board's
 * "My division" slice and trade review's `class_gap` (ADR F2.10a). One account can be several rated
 * people; its established row with the most games represents it, as `getManagerClass` does.
 */
export async function getDivisionsForUsers(userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return out
  try {
    if (!(await classTablesReady())) return out
    const rows = await prisma.$queryRaw<Array<{ userId: string; division: number }>>`
      SELECT DISTINCT ON ("userId") "userId", division
        FROM manager_ratings
       WHERE "userId" = ANY(${ids}::text[]) AND established AND division IS NOT NULL
         AND sport = ${CLASS_SPORT} AND "modelVersion" = ${CLASS_MODEL_VERSION}
       ORDER BY "userId", games DESC, "subjectKey"`
    for (const r of rows) out.set(r.userId, Number(r.division))
  } catch (e) {
    console.warn('[class-rating] division read failed:', e instanceof Error ? e.message : e)
  }
  return out
}
