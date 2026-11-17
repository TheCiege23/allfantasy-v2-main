import type { Prisma, PrismaClient } from '@prisma/client'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'
import { normalizeNflTeam } from '@/lib/redraft/lineupLock'
import type { FinalBoxCoverage } from './gameBoxCoverage'

type StatCoverage = {
  sport: string; source: string; periodId: string; kind: 'game' | 'week'; identitySpace: 'canonical' | 'sleeper'
  season: number; week: number | null; startTime: Date; endTime: Date
  teams: string[]; participantIds: string[]; gameKeys: string[]
  firstFinalObservedAt?: Date; recordedAt?: Date
}
export const STAT_CORRECTION_WINDOW_MS = 12 * 3600_000

/** A final response must be fetched again after the vendor's correction window.
 * Kickoff is not evidence of when a game finished. Preserve the first observed
 * final response, and require a later successful complete response. */
export function statCoverageCorrectionsReady(proof: StatCoverage, now = new Date()): boolean {
  const first = proof.firstFinalObservedAt?.getTime(), fetched = proof.recordedAt?.getTime()
  return first != null && fetched != null && Number.isFinite(first) && Number.isFinite(fetched) &&
    fetched >= first + STAT_CORRECTION_WINDOW_MS && fetched <= now.getTime()
}

/** Historical backfills also need a post-window observation. Revisit a bounded
 * number of their dates through the existing documented ingest, even after
 * those dates have left the normal three-day sweep. */
export async function pendingStatCorrectionDates(db: Pick<PrismaClient, '$queryRaw'>, sport: string,
  now = new Date(), limit = 2): Promise<string[]> {
  if (!['NBA', 'NHL', 'MLB'].includes(sport)) return []
  const rows = await db.$queryRaw<Array<{ day: string }>>`SELECT
      to_char("startTime" AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day
    FROM sports_stat_coverage WHERE sport = ${sport} AND kind = 'game' AND source = 'rolling_insights_live'
      AND "firstFinalObservedAt" <= ${new Date(now.getTime() - STAT_CORRECTION_WINDOW_MS)}
      AND "recordedAt" < "firstFinalObservedAt" + interval '12 hours'
    GROUP BY day ORDER BY min("firstFinalObservedAt"), day LIMIT ${Math.max(1, Math.min(5, Math.floor(limit) || 2))}`
  return rows.map(row => row.day).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day))
}
type Game = { homeTeam: string; awayTeam: string; startTime: Date | null }
export const coverageGameKey = (game: Game, team: (value: string) => string) =>
  JSON.stringify([team(game.homeTeam), team(game.awayTeam), game.startTime?.toISOString()])

export async function writeStatCoverage(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, proof: StatCoverage) {
  await tx.$executeRaw`INSERT INTO sports_stat_coverage
    (sport, source, "periodId", kind, "identitySpace", season, week, "startTime", "endTime", teams, "participantIds", "gameKeys")
    VALUES (${proof.sport}, ${proof.source}, ${proof.periodId}, ${proof.kind}, ${proof.identitySpace}, ${proof.season}, ${proof.week},
      ${proof.startTime}, ${proof.endTime}, ${proof.teams}::text[], ${proof.participantIds}::text[], ${proof.gameKeys}::text[])
    ON CONFLICT (sport, source, "periodId") DO UPDATE SET kind = EXCLUDED.kind, "identitySpace" = EXCLUDED."identitySpace",
      season = EXCLUDED.season, week = EXCLUDED.week, "startTime" = EXCLUDED."startTime", "endTime" = EXCLUDED."endTime",
      "firstFinalObservedAt" = CASE WHEN sports_stat_coverage."startTime" IS DISTINCT FROM EXCLUDED."startTime"
        OR sports_stat_coverage."gameKeys" IS DISTINCT FROM EXCLUDED."gameKeys" THEN now() ELSE sports_stat_coverage."firstFinalObservedAt" END,
      teams = EXCLUDED.teams, "participantIds" = EXCLUDED."participantIds", "gameKeys" = EXCLUDED."gameKeys", "recordedAt" = now()`
}

/** Invalidate one incomplete vendor game without granting table DELETE to the restricted runtime. */
export async function invalidateGameStatCoverage(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, sport: string, periodId: string) {
  let restrictedRole = false
  try { restrictedRole = decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').username) === 'commish_app' } catch {}
  if (restrictedRole) {
    await tx.$executeRaw`SELECT public.af_invalidate_provider_stat_coverage(${sport}, ${'rolling_insights_live'}, ${periodId})`
  } else {
    await tx.$executeRaw`DELETE FROM sports_stat_coverage WHERE sport = ${sport} AND source = ${'rolling_insights_live'} AND "periodId" = ${periodId}`
  }
}

export function dailyBoxCoverage(proof: FinalBoxCoverage): StatCoverage {
  return { sport: proof.sport, source: 'rolling_insights_live', periodId: proof.providerGameId, kind: 'game', identitySpace: 'canonical',
    season: proof.season, week: null, startTime: proof.startTime, endTime: proof.startTime, teams: [proof.homeTeam, proof.awayTeam],
    participantIds: proof.participantIds, gameKeys: [coverageGameKey(proof, value => value)] }
}

/** Sleeper's existing week-wide endpoint is a complete player map. Record its
 * omissions only after a complete final slate, and only when that
 * response includes measured defense stats for every team on the slate.
 * Finalization separately requires a complete post-correction refetch.
 * A successful HTTP response or an empty/partial week alone is insufficient. */
export async function recordNflWeeklyCoverage(db: PrismaClient, season: number, week: number,
  byId: ReadonlyMap<string, unknown>, now = new Date()): Promise<boolean> {
  const games = pickFreshestSourceRows(await db.sportsGame.findMany({ where: { sport: 'NFL', season, week, seasonType: 'regular' } }))
    .filter(game => !/pre|post|playoff/i.test(game.seasonType ?? '') && normalizeGameStatus(game.status) !== 'cancelled')
  if (!games.length || games.some(game => !game.startTime || normalizeGameStatus(game.status) !== 'final')) return false
  const times = games.map(game => game.startTime!.getTime())
  if (Math.max(...times) > now.getTime()) return false
  const teams = [...new Set(games.flatMap(game => [normalizeNflTeam(game.homeTeam), normalizeNflTeam(game.awayTeam)]))].sort()
  if (teams.some(team => !team)) return false
  const defenseTeams = new Set<string>()
  for (const [id, entry] of byId) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const raw = entry as Record<string, unknown>
    if (!Object.values(raw).some(value => typeof value === 'number' && Number.isFinite(value))) return false
    if (/^[A-Z]{2,3}$/.test(id)) {
      const points = raw.pts_allow
      const measured = typeof points === 'number' && Number.isFinite(points)
      // Sleeper omits zero-valued pts_allow but explicitly marks a shutout with pts_allow_0.
      const explicitShutout = points === undefined && raw.pts_allow_0 === 1
      if (measured && raw.pts_allow_0 === 1 && points !== 0) return false
      if (measured || explicitShutout) defenseTeams.add(normalizeNflTeam(id))
    }
  }
  if (teams.some(team => !defenseTeams.has(team))) return false
  await writeStatCoverage(db, { sport: 'NFL', source: 'sleeper_weekly_stats', periodId: `${season}:${week}`, kind: 'week',
    identitySpace: 'sleeper', season, week, startTime: new Date(Math.min(...times)), endTime: new Date(Math.max(...times)),
    teams, participantIds: [...byId.keys()].sort(), gameKeys: games.map(game => coverageGameKey(game, normalizeNflTeam)).sort() })
  return true
}

export async function readStatCoverage(db: PrismaClient, sport: string, season: number, week: number, start: Date, end: Date) {
  const rows = await db.$queryRaw<StatCoverage[]>`SELECT sport, source, "periodId", kind, "identitySpace", season, week,
    "startTime", "endTime", teams, "participantIds", "gameKeys", "firstFinalObservedAt", "recordedAt" FROM sports_stat_coverage
    WHERE sport = ${sport} AND season = ${season} AND
      ((kind = 'game' AND "startTime" >= ${start} AND "startTime" < ${new Date(end.getTime() + 6 * 3600_000)}) OR (kind = 'week' AND week = ${week}))`
  return rows.filter(row => row.sport === sport && row.season === season && Array.isArray(row.participantIds) && row.participantIds.length > 0 &&
    Array.isArray(row.teams) && row.teams.length >= 2 && Array.isArray(row.gameKeys) && row.gameKeys.length > 0 &&
    row.startTime instanceof Date && row.endTime instanceof Date)
}
