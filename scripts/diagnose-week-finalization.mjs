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
  console.log('\nPaste everything above back. It contains counts only.')
} catch (err) {
  console.error('diagnose-week-finalization failed:', err instanceof Error ? err.message.split('\n').slice(-1)[0] : err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
