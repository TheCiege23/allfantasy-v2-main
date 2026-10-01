import 'server-only'

import { prisma } from '@/lib/prisma'
import { CLASS_MODEL_VERSION, GLICKO } from '@/lib/class-rating/engine'
import { divisionBand } from '@/lib/class-rating/divisionGate'
import { CLASS_SPORT, classTablesReady } from '@/lib/class-rating/store'
import { LOG_WEEKS_SHOWN } from '@/lib/class-rating/weekLog'

export { getDivisionsForUsers } from '@/lib/class-rating/reads'

/**
 * The Class tab of `/core/rankings` — read from `manager_ratings` and `manager_rating_events`
 * (ADR F2.10a). Nothing is rated on a page view; the daily writer did that.
 *
 * Ported from PR #1753's Skill tab (`lib/rank/skillRating/skillView.ts`) onto the Class core,
 * per the owner's ruling of 2026-10-01. What changed in the port, and why:
 *
 *   • The rating is ALL-PLAY, so the game log leads with how you did against the whole league
 *     that week. A head-to-head WIN can lower the rating — the log says so rather than hiding it.
 *   • #1753's "beats an average manager" and per-game "win chance" are GONE: F2.10a policy 6
 *     forbids presenting a rating as a win probability for a game.
 *   • The filter is "My division" (±1 division, the matchmaking band), not ±2 Classes.
 *   • Uncertainty travels with every number (F2.10a rule 5): a provisional rating has no Class.
 */

/**
 * The log is the newest WEEKS, every league in each — never the newest N league-weeks.
 * ⚠ A row cap cuts a busy week in half: at 25 league-weeks a manager in twelve leagues saw two
 * weeks, the older one missing some of its leagues, so its total was wrong. The screen groups
 * the rows by week (weekLog.ts), which is what the rating updates on. `LOG_ROW_CAP` only bounds
 * the query.
 */
const LOG_ROW_CAP = 400
const BOARD_LIMIT = 200

export type ClassBoardRow = {
  userId: string
  rank: number
  handle: string
  /** Experience level (XP) — shown as context, never what anyone is matched on. */
  level: number | null
  rating: number
  rd: number
  /** rating − 2·rd: what the board ranks by, so nobody tops it on a lucky few weeks. */
  conservative: number
  classLevel: number
  division: number
  /** Head-to-head W-L(-T) across every rated league-week. */
  record: string
  games: number
  /** Share of established ratings below this one, 0–1. */
  percentile: number
  isYou: boolean
}

export type ClassLogRow = {
  leagueId: string
  leagueName: string | null
  season: number
  week: number
  pointsFor: number
  /** Teams beaten (ties count half) and teams faced that week — what actually moved the rating. */
  allPlayWins: number
  allPlayGames: number
  opponentLabel: string | null
  opponentClassNow: number | null
  result: 'W' | 'L' | 'T' | null
  pointsAgainst: number | null
  /** The whole week's move (every league that week folds into one update). */
  weekChange: number
  /** This league's share of `weekChange`; the shares sum to it. */
  leagueShare: number
  ratingAfter: number
}

export type ClassYou = {
  status: 'established' | 'provisional'
  rating: number
  rd: number
  conservative: number
  games: number
  record: string
  percentile: number | null
  classLevel: number | null
  division: number | null
  /** Divisions this manager can join public leagues in. Null while provisional. */
  band: [number, number] | null
  boardRank: number | null
  /** RD still to shed before the rating is established (0 once it is). */
  rdToEstablish: number
}

export type ClassView = {
  sport: string
  computedAt: string | null
  /** Everyone rated, on AllFantasy or not. */
  rated: number
  established: number
  board: ClassBoardRow[]
  you: ClassYou | null
  log: ClassLogRow[]
  /** The board narrowed to your division band (`?division=mine`). Null without an established rating. */
  divisionFilter: { active: boolean; band: [number, number]; href: string; offHref: string } | null
  /** Why there is nothing to show, when there is nothing. */
  empty: string | null
}

type RatingRow = {
  subjectKey: string
  userId: string | null
  rating: number
  rd: number
  games: number
  established: boolean
  percentile: number | null
  classLevel: number | null
  division: number | null
  computedAt: Date
}

const fmtRecord = (w: number, l: number, t: number) => (t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`)

async function recordsFor(subjectKeys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (subjectKeys.length === 0) return out
  const rows = await prisma.$queryRaw<Array<{ subjectKey: string; w: number; l: number; t: number }>>`
    SELECT "subjectKey",
           count(*) FILTER (WHERE result = 'W')::int AS w,
           count(*) FILTER (WHERE result = 'L')::int AS l,
           count(*) FILTER (WHERE result = 'T')::int AS t
      FROM manager_rating_events
     WHERE "subjectKey" = ANY(${subjectKeys}::text[]) AND sport = ${CLASS_SPORT} AND "modelVersion" = ${CLASS_MODEL_VERSION}
     GROUP BY "subjectKey"`
  for (const r of rows) out.set(r.subjectKey, fmtRecord(Number(r.w), Number(r.l), Number(r.t)))
  return out
}

/** Each AF account's best rating row: established first, then most games. One per account. */
async function bestRowsByUser(userIds: string[] | null): Promise<RatingRow[]> {
  return prisma.$queryRaw<RatingRow[]>`
    SELECT DISTINCT ON ("userId") "subjectKey", "userId", rating, rd, games, established, percentile,
           "classLevel", division, "computedAt"
      FROM manager_ratings
     WHERE "userId" IS NOT NULL AND sport = ${CLASS_SPORT} AND "modelVersion" = ${CLASS_MODEL_VERSION}
       AND (${userIds == null} OR "userId" = ANY(${userIds ?? []}::text[]))
     ORDER BY "userId", established DESC, games DESC, "subjectKey"`
}

export async function getClassView(userId: string | null, divisionParam: string | null = null): Promise<ClassView> {
  const empty = (why: string, computedAt: string | null = null): ClassView => ({
    sport: CLASS_SPORT,
    computedAt,
    rated: 0,
    established: 0,
    board: [],
    you: null,
    log: [],
    divisionFilter: null,
    empty: why,
  })
  if (!(await classTablesReady())) {
    return empty('Class ratings are calculated once a day. The first run has not finished yet — check back tomorrow.')
  }

  const [totals] = await prisma.$queryRaw<Array<{ rated: number; established: number; computedAt: Date | null }>>`
    SELECT count(*)::int AS rated, count(*) FILTER (WHERE established)::int AS established, max("computedAt") AS "computedAt"
      FROM manager_ratings WHERE sport = ${CLASS_SPORT} AND "modelVersion" = ${CLASS_MODEL_VERSION}`
  const computedAt = totals?.computedAt ? totals.computedAt.toISOString() : null
  if (!totals || Number(totals.rated) === 0) {
    return empty(
      'No week has been rated yet. Import a league with weekly matchups and your Class appears after the next finished week.',
      computedAt,
    )
  }

  const everyone = await bestRowsByUser(null)
  const mine = userId ? everyone.find((r) => r.userId === userId) ?? null : null
  const myDivision = mine?.established && mine.division != null ? Number(mine.division) : null
  const myBand = myDivision != null ? divisionBand(myDivision) : null
  const divisionMine = myBand != null && divisionParam === 'mine'

  const ranked = everyone
    .filter((r) => r.established && r.classLevel != null && r.division != null && r.percentile != null)
    .map((r) => ({ r, conservative: r.rating - 2 * r.rd }))
    .sort((a, b) => b.conservative - a.conservative)
  const shown = ranked
    .filter(({ r }) => !divisionMine || (myBand != null && Number(r.division) >= myBand[0] && Number(r.division) <= myBand[1]))
    .slice(0, BOARD_LIMIT)

  const users = await prisma.appUser
    .findMany({
      where: { id: { in: shown.map(({ r }) => r.userId!) } },
      select: { id: true, username: true, displayName: true, profile: { select: { xpLevel: true, legacyCareerLevel: true } } },
    })
    .catch(() => [])
  const userById = new Map(users.map((u) => [u.id, u]))
  const records = await recordsFor([...shown.map(({ r }) => r.subjectKey), ...(mine ? [mine.subjectKey] : [])])

  const board: ClassBoardRow[] = shown.map(({ r, conservative }, i) => {
    const u = userById.get(r.userId!)
    return {
      userId: r.userId!,
      rank: i + 1,
      handle: u?.displayName?.trim() || u?.username?.trim() || 'Manager',
      level: u?.profile?.xpLevel ?? u?.profile?.legacyCareerLevel ?? null,
      rating: Math.round(r.rating),
      rd: Math.round(r.rd),
      conservative: Math.round(conservative),
      classLevel: Number(r.classLevel),
      division: Number(r.division),
      record: records.get(r.subjectKey) ?? '0-0',
      games: Number(r.games),
      percentile: Number(r.percentile),
      isYou: r.userId === userId,
    }
  })

  let you: ClassYou | null = null
  if (mine) {
    const at = ranked.findIndex(({ r }) => r.userId === userId)
    you = {
      status: mine.established && mine.classLevel != null ? 'established' : 'provisional',
      rating: Math.round(mine.rating),
      rd: Math.round(mine.rd),
      conservative: Math.round(mine.rating - 2 * mine.rd),
      games: Number(mine.games),
      record: records.get(mine.subjectKey) ?? '0-0',
      percentile: mine.established && mine.percentile != null ? Number(mine.percentile) : null,
      classLevel: mine.established && mine.classLevel != null ? Number(mine.classLevel) : null,
      division: myDivision,
      band: myBand,
      boardRank: at >= 0 ? at + 1 : null,
      rdToEstablish: Math.max(0, Math.ceil(mine.rd - GLICKO.establishedRd)),
    }
  }

  const log: ClassLogRow[] = mine
    ? (
        await prisma.$queryRaw<
          Array<{
            leagueId: string
            leagueName: string | null
            season: number
            week: number
            pointsFor: number
            allPlayWins: number
            allPlayGames: number
            result: string | null
            pointsAgainst: number | null
            ratingBefore: number
            ratingAfter: number
            ratingDelta: number
            oppClass: number | null
            oppHandle: string | null
            oppTeamOwner: string | null
          }>
        >`
          SELECT e."leagueId", l.name AS "leagueName", e.season, e.week, e."pointsFor", e."allPlayWins", e."allPlayGames",
                 e.result, e."pointsAgainst", e."ratingBefore", e."ratingAfter", e."ratingDelta",
                 o."classLevel" AS "oppClass",
                 coalesce(nullif(trim(ou."displayName"), ''), nullif(trim(ou.username), '')) AS "oppHandle",
                 (SELECT nullif(trim(lt."ownerName"), '') FROM league_teams lt
                   WHERE lt."leagueId" = e."leagueId"
                     AND lt."platformUserId" = substr(e."opponentKey", strpos(e."opponentKey", ':') + 1)
                   LIMIT 1) AS "oppTeamOwner"
            FROM manager_rating_events e
            LEFT JOIN leagues l ON l.id = e."leagueId"
            LEFT JOIN manager_ratings o
                   ON o."subjectKey" = e."opponentKey" AND o.sport = e.sport AND o."modelVersion" = e."modelVersion"
            LEFT JOIN app_users ou ON ou.id = o."userId"
           WHERE e."subjectKey" = ${mine.subjectKey} AND e.sport = ${CLASS_SPORT} AND e."modelVersion" = ${CLASS_MODEL_VERSION}
             AND (e.season, e.week) IN (
                   SELECT w.season, w.week FROM (
                     SELECT DISTINCT season, week FROM manager_rating_events
                      WHERE "subjectKey" = ${mine.subjectKey} AND sport = ${CLASS_SPORT} AND "modelVersion" = ${CLASS_MODEL_VERSION}
                   ) w
                   ORDER BY w.season DESC, w.week DESC
                   LIMIT ${LOG_WEEKS_SHOWN})
           ORDER BY e.season DESC, e.week DESC, e."ratingDelta" DESC, e."leagueId"
           LIMIT ${LOG_ROW_CAP}`
      ).map((e) => ({
        leagueId: e.leagueId,
        leagueName: e.leagueName,
        season: Number(e.season),
        week: Number(e.week),
        pointsFor: Number(e.pointsFor),
        allPlayWins: Number(e.allPlayWins),
        allPlayGames: Number(e.allPlayGames),
        opponentLabel: e.oppHandle ?? e.oppTeamOwner ?? null,
        opponentClassNow: e.oppClass == null ? null : Number(e.oppClass),
        result: e.result === 'W' || e.result === 'L' || e.result === 'T' ? e.result : null,
        pointsAgainst: e.pointsAgainst == null ? null : Number(e.pointsAgainst),
        weekChange: Number(e.ratingAfter) - Number(e.ratingBefore),
        leagueShare: Number(e.ratingDelta),
        ratingAfter: Number(e.ratingAfter),
      }))
    : []

  return {
    sport: CLASS_SPORT,
    computedAt,
    rated: Number(totals.rated),
    established: Number(totals.established),
    board,
    you,
    log,
    divisionFilter: myBand
      ? { active: divisionMine, band: myBand, href: '/core/rankings?scope=class&division=mine', offHref: '/core/rankings?scope=class' }
      : null,
    empty: null,
  }
}
