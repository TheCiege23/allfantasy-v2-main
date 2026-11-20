import 'server-only'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { fetchNflWeekPlayerMap } from '@/lib/workers/providers/survivorSleeper'
import { normalizeNflWeeklyStats, normalizeNflTeamDefenseWeeklyStats } from '@/lib/scoring-runtime/nflStatNormalization'
import { normalizeNflTeam } from '@/lib/redraft/lineupLock'
import { recordNflWeeklyCoverage, statCoverageCorrectionsReady, type StatCoverage } from '@/lib/sports-data/statCoverage'

export function sgNflSnapshotRows(payload: ReadonlyMap<string, unknown>) {
  const rows: Array<{ playerId: string; stats: Record<string, number> }> = []
  for (const [id, value] of payload) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Malformed NFL weekly stat row')
    // TEAM_* entries are offense aggregates, distinct from the bare team DST rows.
    if (/^TEAM_[A-Z]{2,3}$/.test(id)) continue
    const defense = /^[A-Z]{2,3}$/.test(id)
    if (!defense && !/^\d+$/.test(id)) throw Error('Unrecognized NFL provider identity')
    const stats = defense ? normalizeNflTeamDefenseWeeklyStats(value as Record<string, unknown>) : normalizeNflWeeklyStats(value as Record<string, unknown>)
    if (!Object.values(value).some(n => typeof n === 'number' && Number.isFinite(n))) throw Error('NFL weekly stat row has no measurements')
    // A complete sparse response includes active players with no scoring events.
    // Retain the measured row rather than confusing a verified zero with a missing feed.
    if (!Object.keys(stats).length) stats.provider_stat_row = 1
    rows.push({ playerId: defense ? `nfl:def:${normalizeNflTeam(id)}` : id, stats })
  }
  if (!rows.length) throw Error('NFL weekly stats are empty')
  return rows
}

/** Raw rows and their complete-response receipt commit together. No league-specific fantasy total is stored. */
export async function syncSGNflWeek(season: number, week: number, now = new Date()) {
  const payload = await fetchNflWeekPlayerMap(season, week, 'regular')
  if (!payload?.size) throw Error('NFL weekly stats could not be fetched')
  const lines = sgNflSnapshotRows(payload)
  return prisma.$transaction(async tx => {
    const complete = await recordNflWeeklyCoverage(tx, season, week, payload, now)
    if (!complete) {
      let restricted = false
      try { restricted = decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').username) === 'commish_app' } catch {}
      if (restricted) await tx.$executeRaw`SELECT public.af_invalidate_provider_stat_coverage(${'NFL'}, ${'sleeper_weekly_stats'}, ${`${season}:${week}`})`
      else await tx.$executeRaw`DELETE FROM sports_stat_coverage WHERE sport='NFL' AND source='sleeper_weekly_stats' AND "periodId"=${`${season}:${week}`}`
    }
    const proof = complete ? await tx.$queryRaw<StatCoverage[]>`SELECT "firstFinalObservedAt","recordedAt" FROM sports_stat_coverage WHERE sport='NFL' AND source='sleeper_weekly_stats' AND "periodId"=${`${season}:${week}`}` : []
    const finalized = proof.length > 0 && statCoverageCorrectionsReady(proof[0])
    const rows = lines.map(line => ({ ...line, id: randomUUID(), season, week, sport: 'NFL', isFinalized: finalized, updatedAt: now }))
    const changed = await tx.$executeRaw(Prisma.sql`INSERT INTO player_weekly_scores (id,"playerId",season,week,sport,stats,"fantasyPts","isFinalized","updatedAt")
      SELECT r.id,r."playerId",r.season,r.week,r.sport,r.stats,0,r."isFinalized",r."updatedAt"
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(id text,"playerId" text,season int,week int,sport text,stats jsonb,"isFinalized" boolean,"updatedAt" timestamptz)
      ON CONFLICT ("playerId",week,season,sport) DO UPDATE SET stats=EXCLUDED.stats,"isFinalized"=EXCLUDED."isFinalized","updatedAt"=EXCLUDED."updatedAt"
      WHERE player_weekly_scores.stats IS DISTINCT FROM EXCLUDED.stats OR player_weekly_scores."isFinalized" IS DISTINCT FROM EXCLUDED."isFinalized"`)
    // A corrected complete response may remove a previously reported participant.
    // Its old row must not survive and contribute phantom points.
    const removed = complete ? await tx.playerWeeklyScore.deleteMany({ where: { sport: 'NFL', season, week, playerId: { notIn: lines.map(line => line.playerId) } } }) : { count: 0 }
    return { week, fetched: lines.length, changed, removed: removed.count, complete, correctionsReady: finalized }
  }, { timeout: 30_000 })
}
