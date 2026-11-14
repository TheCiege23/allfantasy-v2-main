#!/usr/bin/env node
/**
 * READ-ONLY. Why has weekly scoring stopped finalizing? (2026-11-14)
 *
 *   railway run node scripts/diagnose-week-finalization.mjs [--season=2026] [--sport=NFL]
 *
 * The draft backtest found PlayerWeeklyScore finalized only through week 5 while NFL was in week 10.
 * A week is finalized by the `cron-redraft-score-sync` job (app/api/redraft/score-sync/route.ts →
 * lib/redraft/weekFinalizer.ts) only for AllFantasy-run seasons that have open matchups, and it
 * REFUSES with a named reason when it cannot prove the week is over and the stats are in. Every
 * refusal is counted into that job's sync_job_runs metadata. This prints the four things that tell
 * "stuck" from "nothing to finalize":
 *
 *   1. the native seasons for the sport/season, by status and currentWeek;
 *   2. their matchups by week and status (a week holding non-final matchups is open);
 *   3. PlayerWeeklyScore rows by week, finalized vs not;
 *   4. the score-sync job over the last 24h: is it firing, how long, what it finalized, and the
 *      refusal reasons it counted.
 *
 * Counts only — no user, league, season or player identifiers. Prints the database host, never the URL.
 */
import { PrismaClient } from '@prisma/client'

function arg(name, d) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : d
}
const season = Number(arg('season', '2026'))
const sport = String(arg('sport', 'NFL'))
const sports = [sport.toUpperCase(), sport.toLowerCase()]

function host() {
  try {
    return new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || '').hostname || '(unknown)'
  } catch {
    return '(unparseable URL)'
  }
}
const n = (v) => Number(v ?? 0)
const iso = (d) => (d ? new Date(d).toISOString().replace('.000Z', 'Z') : '-')

const prisma = new PrismaClient()
try {
  console.log(`diagnose-week-finalization: ${host()} (read-only), ${sports[0]} ${season}\n`)

  // 1. Seasons
  const seasons = await prisma.$queryRaw`
    SELECT status, "currentWeek" AS week, COUNT(*)::int AS seasons
    FROM redraft_seasons WHERE sport = ANY(${sports}) AND season = ${season}
    GROUP BY 1, 2 ORDER BY 1, 2`
  console.log('1. Native seasons by status / currentWeek:')
  if (!seasons.length) console.log('   (none)')
  for (const r of seasons) console.log(`   ${r.status.padEnd(12)} week ${String(r.week).padStart(2)}: ${r.seasons}`)

  // 2. Matchups
  const matchups = await prisma.$queryRaw`
    SELECT m.week, m.status, COUNT(*)::int AS matchups, COUNT(DISTINCT m."seasonId")::int AS seasons
    FROM redraft_matchups m JOIN redraft_seasons s ON s.id = m."seasonId"
    WHERE s.sport = ANY(${sports}) AND s.season = ${season} AND m."awayRosterId" IS NOT NULL
    GROUP BY 1, 2 ORDER BY 1, 2`
  console.log('\n2. Matchups (byes excluded) by week / status — [matchups in seasons]:')
  const byWeek = new Map()
  for (const r of matchups) {
    const row = byWeek.get(r.week) ?? {}
    row[r.status] = `${r.matchups} in ${r.seasons}`
    byWeek.set(r.week, row)
  }
  if (!byWeek.size) console.log('   (none)')
  for (const [week, row] of [...byWeek].sort((a, b) => a[0] - b[0])) {
    console.log(`   week ${String(week).padStart(2)}: ${Object.entries(row).map(([s, v]) => `${s} ${v}`).join(' · ')}`)
  }
  const oldestOpen = await prisma.$queryRaw`
    SELECT oldest AS week, COUNT(*)::int AS seasons FROM (
      SELECT m."seasonId", MIN(m.week) AS oldest
      FROM redraft_matchups m JOIN redraft_seasons s ON s.id = m."seasonId"
      WHERE s.sport = ANY(${sports}) AND s.season = ${season} AND s.status <> 'complete'
        AND m."awayRosterId" IS NOT NULL AND m.status <> 'final'
      GROUP BY 1) t
    GROUP BY 1 ORDER BY 1`
  console.log('   Oldest NON-FINAL week per unfinished season (a season cannot advance past it):')
  if (!oldestOpen.length) console.log('   (no unfinished season has an open matchup)')
  for (const r of oldestOpen) console.log(`     week ${String(r.week).padStart(2)}: ${r.seasons} season(s)`)

  // 3. PlayerWeeklyScore
  const scores = await prisma.$queryRaw`
    SELECT week, COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE "isFinalized")::int AS finalized,
           MAX("updatedAt") AS last_write
    FROM player_weekly_scores WHERE sport = ANY(${sports}) AND season = ${season}
    GROUP BY 1 ORDER BY 1`
  console.log('\n3. PlayerWeeklyScore by week — rows / finalized / last write:')
  if (!scores.length) console.log('   (none)')
  for (const r of scores) console.log(`   week ${String(r.week).padStart(2)}: ${String(r.rows).padStart(5)} rows, ${String(r.finalized).padStart(5)} finalized, last write ${iso(r.last_write)}`)

  // 4. The job
  const runs = await prisma.$queryRaw`
    SELECT status, started_at, duration_ms, metadata->'redraft' AS redraft
    FROM sync_job_runs
    WHERE job_name = 'cron-redraft-score-sync' AND started_at > NOW() - INTERVAL '24 hours'
    ORDER BY started_at DESC`
  const last = await prisma.$queryRaw`
    SELECT MAX(started_at) AS last_start FROM sync_job_runs WHERE job_name = 'cron-redraft-score-sync'`
  const lastFinalize = await prisma.$queryRaw`
    SELECT MAX(started_at) AS at FROM sync_job_runs
    WHERE job_name = 'cron-redraft-score-sync' AND started_at > NOW() - INTERVAL '45 days'
      AND COALESCE((metadata->'redraft'->>'weeksFinalized')::int, 0) > 0`
  const status = {}
  const refusals = {}
  let finalized = 0
  let finalizeFailed = 0
  let considered = 0
  const durations = []
  for (const r of runs) {
    status[r.status] = (status[r.status] ?? 0) + 1
    if (r.duration_ms != null) durations.push(n(r.duration_ms))
    const red = r.redraft ?? {}
    finalized += n(red.weeksFinalized)
    finalizeFailed += n(red.finalizeFailed)
    considered += n(red.seasonsConsidered)
    for (const [k, v] of Object.entries(red.finalizeRefusals ?? {})) refusals[k] = (refusals[k] ?? 0) + n(v)
  }
  durations.sort((a, b) => a - b)
  const pct = (p) => (durations.length ? `${Math.round(durations[Math.min(durations.length - 1, Math.floor(p * durations.length))] / 1000)}s` : '-')
  console.log('\n4. cron-redraft-score-sync, last 24h (expected ~288 runs at */5):')
  console.log(`   last run started ${iso(last[0]?.last_start)}; ${runs.length} runs ${JSON.stringify(status)}`)
  console.log(`   duration median ${pct(0.5)}, p90 ${pct(0.9)}, max ${pct(1)}`)
  console.log(`   seasons considered (summed over runs) ${considered}; weeks finalized ${finalized}; finalize threw ${finalizeFailed}`)
  console.log(`   refusals (summed over runs): ${Object.keys(refusals).length ? JSON.stringify(refusals) : '(none)'}`)
  console.log(`   last run that finalized any week (45d): ${iso(lastFinalize[0]?.at)}`)

  // 5. Why the stat rows are missing (added after the first production run, 2026-11-14).
  //   An NFL offensive player's weekly row comes only from Sleeper's week-wide stats call
  //   (lib/live-scoring/nflLiveStatsProvider.ts), which returns an EMPTY map — silently — when the
  //   call is refused, fails, or the roster ids are not Sleeper ids. Team defenses are derived from
  //   SportsGame instead, which is why a week can hold ~8 rows and nothing else.
  const calls = await prisma.$queryRaw`
    SELECT DATE(called_at) AS day, COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE status = 1)::int AS ok, COUNT(*) FILTER (WHERE status <> 1)::int AS failed
    FROM api_call_log
    WHERE provider = 'sleeper' AND endpoint = 'stats/nfl/week' AND called_at > NOW() - INTERVAL '50 days'
    GROUP BY 1 ORDER BY 1`
  console.log('\n5a. Sleeper week-stats calls per day (status 1 = HTTP ok, 0 = not ok), last 50 days:')
  if (!calls.length) console.log('   (no calls logged)')
  for (const r of calls) console.log(`   ${String(r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day)}: ${r.calls} calls, ${r.ok} ok, ${r.failed} failed`)

  const audits = await prisma.$queryRaw`
    SELECT a."createdAt" AS at,
           a.details->>'week' AS week,
           a.details->>'scoresUpserted' AS upserted,
           a.details->>'weekStatsFromProvider' AS from_provider,
           jsonb_array_length(COALESCE(a.details->'missingCachePlayerIds', '[]'::jsonb)) AS missing_cache,
           jsonb_array_length(COALESCE(a.details->'missingWeekPlayerIds', '[]'::jsonb)) AS missing_week,
           jsonb_array_length(COALESCE(a.details->'missingStatPlayerIds', '[]'::jsonb)) AS missing_stat
    FROM admin_audit_log a JOIN redraft_seasons s ON s.id = a."targetId"
    WHERE a.action = 'redraft_score_sync' AND s.sport = ANY(${sports}) AND s.season = ${season}
    ORDER BY a."createdAt" DESC LIMIT 8`
  console.log('\n5b. Latest weekly stat syncs for those seasons (from admin_audit_log):')
  if (!audits.length) console.log('   (none logged)')
  for (const r of audits) {
    console.log(`   ${iso(r.at)} week ${r.week ?? '?'}: upserted ${r.upserted ?? '?'}, from Sleeper ${r.from_provider ?? '?'}, missing cache ${r.missing_cache} / week ${r.missing_week} / stat ${r.missing_stat}`)
  }

  const ids = await prisma.$queryRaw`
    SELECT CASE WHEN rp."playerId" ~ '^[0-9]+$' THEN 'numeric (Sleeper-style)'
                WHEN rp."playerId" ILIKE 'nfl:def:%' THEN 'team defense (nfl:def:XX)'
                WHEN rp."playerId" ~ '^[A-Z]{2,3}$' THEN 'team code (DEF)'
                ELSE 'other format' END AS shape,
           COUNT(*)::int AS players,
           COUNT(*) FILTER (WHERE rp."addedAt" >= DATE '2026-10-01')::int AS added_since_oct
    FROM redraft_roster_players rp
    JOIN redraft_rosters r ON r.id = rp."rosterId"
    JOIN redraft_seasons s ON s.id = r."seasonId"
    WHERE s.sport = ANY(${sports}) AND s.season = ${season} AND rp."droppedAt" IS NULL
      AND EXISTS (SELECT 1 FROM redraft_matchups m WHERE m."seasonId" = s.id)
    GROUP BY 1 ORDER BY 2 DESC`
  console.log('\n5c. Rostered player-id formats in seasons that have matchups (Sleeper stats are keyed by numeric id):')
  if (!ids.length) console.log('   (none)')
  for (const r of ids) console.log(`   ${r.shape}: ${r.players} (added since Oct 1: ${r.added_since_oct})`)

  // 6. Where the rostered players went (added after the second run, 2026-11-14): 5c found only 12
  //    ACTIVE players across every roster of the stuck season. The sync fetches stats only for
  //    active players; the finalizer still expects the week's starters. So: what kind of league,
  //    when were players dropped, and what wrote the drops.
  const leagues = await prisma.$queryRaw`
    SELECT l.platform, l."leagueVariant" AS variant, l."leagueType" AS type, l."lifecycleState"::text AS lifecycle,
           l."bestBallMode" AS best_ball, l."guillotineMode" AS guillotine, l."survivorMode" AS survivor,
           DATE(l."createdAt") AS created,
           (SELECT COUNT(*)::int FROM redraft_rosters r WHERE r."seasonId" = s.id) AS rosters
    FROM redraft_seasons s JOIN leagues l ON l.id = s."leagueId"
    WHERE s.sport = ANY(${sports}) AND s.season = ${season}
      AND EXISTS (SELECT 1 FROM redraft_matchups m WHERE m."seasonId" = s.id)`
  console.log('\n6a. Seasons with matchups — league settings:')
  for (const r of leagues) {
    console.log(`   platform ${r.platform}, variant ${r.variant ?? '-'}, type ${r.type ?? '-'}, lifecycle ${r.lifecycle}, bestBall ${r.best_ball}, guillotine ${r.guillotine}, survivor ${r.survivor}, created ${String(r.created instanceof Date ? r.created.toISOString().slice(0, 10) : r.created)}, ${r.rosters} rosters`)
  }

  const players = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE rp."droppedAt" IS NULL)::int AS active,
           COUNT(*) FILTER (WHERE rp."droppedAt" IS NOT NULL)::int AS dropped
    FROM redraft_roster_players rp
    JOIN redraft_rosters r ON r.id = rp."rosterId"
    JOIN redraft_seasons s ON s.id = r."seasonId"
    WHERE s.sport = ANY(${sports}) AND s.season = ${season}
      AND EXISTS (SELECT 1 FROM redraft_matchups m WHERE m."seasonId" = s.id)`
  const p0 = players[0] ?? {}
  console.log(`\n6b. Roster player rows: ${p0.total ?? 0} total, ${p0.active ?? 0} active, ${p0.dropped ?? 0} dropped`)

  const drops = await prisma.$queryRaw`
    SELECT DATE(rp."droppedAt") AS day, rp."acquisitionType" AS acquired, COUNT(*)::int AS dropped
    FROM redraft_roster_players rp
    JOIN redraft_rosters r ON r.id = rp."rosterId"
    JOIN redraft_seasons s ON s.id = r."seasonId"
    WHERE s.sport = ANY(${sports}) AND s.season = ${season} AND rp."droppedAt" IS NOT NULL
      AND EXISTS (SELECT 1 FROM redraft_matchups m WHERE m."seasonId" = s.id)
    GROUP BY 1, 2 ORDER BY 3 DESC, 1 LIMIT 15`
  console.log('6c. Drops by day / how the player was acquired (top 15):')
  if (!drops.length) console.log('   (none)')
  for (const r of drops) console.log(`   ${String(r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day)} ${String(r.acquired).padEnd(12)} ${r.dropped}`)

  const moves = await prisma.$queryRaw`
    SELECT DATE(h."createdAt") AS day, h.source, COUNT(*)::int AS moves,
           COUNT(*) FILTER (WHERE h."actorUserId" IS NULL)::int AS no_actor,
           COUNT(*) FILTER (WHERE h."actorUserId" LIKE 'system%' OR h."actorUserId" LIKE 'cron%' OR h."actorUserId" LIKE 'ai%')::int AS system_actor
    FROM redraft_roster_move_history h JOIN redraft_seasons s ON s.id = h."seasonId"
    WHERE s.sport = ANY(${sports}) AND s.season = ${season}
      AND EXISTS (SELECT 1 FROM redraft_matchups m WHERE m."seasonId" = s.id)
    GROUP BY 1, 2 ORDER BY 3 DESC, 1 LIMIT 15`
  console.log('6d. Roster move history by day / source (top 15) — moves, with no actor, with a system/cron/ai actor:')
  if (!moves.length) console.log('   (none)')
  for (const r of moves) console.log(`   ${String(r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day)} ${String(r.source).padEnd(24)} ${r.moves} (no actor ${r.no_actor}, system ${r.system_actor})`)

  console.log('\nPaste everything above back. It contains counts only.')
} catch (err) {
  console.error('diagnose-week-finalization failed:', err instanceof Error ? err.message.split('\n').slice(-1)[0] : err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
