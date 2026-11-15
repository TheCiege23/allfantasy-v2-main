#!/usr/bin/env node
/**
 * READ-ONLY. The advice ledger (2026-11-14, waivers 2026-11-15): how did "start X over Y" and
 * "add X" turn out?
 *
 *   railway run node scripts/advice-ledger-report.mjs [--season=2026] [--season-opener=2026-09-10]
 *
 * Every start/sit call in `chimmy_advice` — Chimmy's (start-vs comparison, chat), the triage card's
 * tip, and since 2026-11-14 My Team's bench check — graded against the platform's weekly scores
 * (`league_player_weekly_scores`, the same rows the Receipts card reads):
 *
 *   right   the recommended player outscored the one he was recommended over
 *   wrong   the other way round
 *   same    within a point either way — the Receipts card's rule (LEDGER_SAME_BAND), so the counts agree
 *   pending the week is not over (its Monday night has not passed)
 *   unscored either player has no score row that week
 *   withdrawn the surface stopped making the call before kickoff (My Team only) — never graded
 *
 * Where the call carries projections (`rec_projected` / `alt_projected`, the ledger migration), it also
 * reports how well the projected gap predicted the real one, and the hit rate by projected gap.
 *
 * Counts and points only — no user, league or player identifiers. Prints the database host, never the URL.
 */
import { PrismaClient } from '@prisma/client'

function arg(name, d) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : d
}
const season = Number(arg('season', '2026'))
const opener = new Date(`${arg('season-opener', '2026-09-10')}T00:00:00Z`)

function host() {
  try {
    return new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || '').hostname || '(unknown)'
  } catch {
    return '(unparseable URL)'
  }
}

/** The last week whose games are all over: its Thursday kickoff plus five days (Monday night) has passed. */
function completedThroughWeek(now) {
  let done = 0
  for (let w = 1; w <= 18; w++) if (opener.getTime() + (w - 1) * 7 * 86_400_000 + 5 * 86_400_000 <= now.getTime()) done = w
  return done
}

const round1 = (n) => Math.round(n * 10) / 10
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '-')

const prisma = new PrismaClient()
try {
  const through = completedThroughWeek(new Date())
  console.log(`advice-ledger-report: ${host()} (read-only), season ${season}, graded through week ${through}\n`)

  const cols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'chimmy_advice' AND column_name IN ('rec_projected', 'alt_projected', 'withdrawn_at')`
  const has = new Set(cols.map((c) => c.column_name))
  const ledger = has.has('rec_projected') && has.has('alt_projected') && has.has('withdrawn_at')
  if (!ledger) console.log('(the ledger migration is not applied: no projections or withdrawals to read yet)\n')

  const rows = ledger
    ? await prisma.$queryRaw`
        SELECT a.surface, a.week, a.confidence_pct AS confidence, a.rec_projected AS rec_proj, a.alt_projected AS alt_proj,
               a.withdrawn_at IS NOT NULL AS withdrawn,
               r.points AS rec_pts, s.points AS alt_pts
        FROM chimmy_advice a
        JOIN leagues l ON l.id = a.league_id
        LEFT JOIN league_player_weekly_scores r
          ON r."leagueId" = l."platformLeagueId" AND r."seasonYear" = a.season AND r.week = a.week AND r."playerId" = a.rec_player_key
        LEFT JOIN league_player_weekly_scores s
          ON s."leagueId" = l."platformLeagueId" AND s."seasonYear" = a.season AND s.week = a.week AND s."playerId" = a.alt_player_key
        WHERE a.advice_type = 'start_sit' AND a.alt_player_key <> '' AND a.season = ${season}`
    : await prisma.$queryRaw`
        SELECT a.surface, a.week, a.confidence_pct AS confidence, NULL::float8 AS rec_proj, NULL::float8 AS alt_proj,
               false AS withdrawn,
               r.points AS rec_pts, s.points AS alt_pts
        FROM chimmy_advice a
        JOIN leagues l ON l.id = a.league_id
        LEFT JOIN league_player_weekly_scores r
          ON r."leagueId" = l."platformLeagueId" AND r."seasonYear" = a.season AND r.week = a.week AND r."playerId" = a.rec_player_key
        LEFT JOIN league_player_weekly_scores s
          ON s."leagueId" = l."platformLeagueId" AND s."seasonYear" = a.season AND s.week = a.week AND s."playerId" = a.alt_player_key
        WHERE a.advice_type = 'start_sit' AND a.alt_player_key <> '' AND a.season = ${season}`

  const bySurface = new Map()
  const projBuckets = new Map()
  const projStats = { n: 0, absErr: 0, gapCaptured: 0 }
  for (const r of rows) {
    const s = bySurface.get(r.surface) ?? { calls: 0, withdrawn: 0, pending: 0, unscored: 0, right: 0, wrong: 0, same: 0, margin: 0 }
    bySurface.set(r.surface, s)
    s.calls++
    if (r.withdrawn) { s.withdrawn++; continue }
    if (Number(r.week) > through) { s.pending++; continue }
    if (r.rec_pts == null || r.alt_pts == null) { s.unscored++; continue }
    const rec = Number(r.rec_pts)
    const alt = Number(r.alt_pts)
    const d = rec - alt
    s.margin += d
    // lib/chimmy-outcomes/ledgerRecord.ts `gradeStartSit`: within 1 point is "same", as on the Receipts card.
    if (Math.abs(d) < 1) s.same++
    else if (d > 0) s.right++
    else s.wrong++

    if (r.rec_proj != null && r.alt_proj != null) {
      const rp = Number(r.rec_proj)
      const ap = Number(r.alt_proj)
      projStats.n++
      projStats.absErr += Math.abs(rec - rp) + Math.abs(alt - ap)
      projStats.gapCaptured += d - (rp - ap)
      const gap = rp - ap
      const bucket = gap < 4 ? 'projected gap <4' : gap < 7 ? 'projected gap 4-7' : 'projected gap 7+'
      const b = projBuckets.get(bucket) ?? { n: 0, right: 0, margin: 0 }
      b.n++
      if (d > 0) b.right++
      b.margin += d
      projBuckets.set(bucket, b)
    }
  }

  console.log('Start/sit calls by surface (right = the recommended player outscored the other):')
  if (!bySurface.size) console.log('  (none)')
  for (const [surface, s] of [...bySurface].sort((a, b) => b[1].calls - a[1].calls)) {
    const graded = s.right + s.wrong + s.same
    console.log(`  ${surface.padEnd(22)} ${String(s.calls).padStart(5)} calls · graded ${graded}: right ${s.right} / wrong ${s.wrong} / same ${s.same} → ${pct(s.right, s.right + s.wrong)} right, avg ${graded ? round1(s.margin / graded) : '-'} pts gained per call · pending ${s.pending} · unscored ${s.unscored} · withdrawn ${s.withdrawn}`)
  }

  console.log('\nCalls with projections (the ledger):')
  if (!projStats.n) console.log('  (none graded yet)')
  else {
    console.log(`  ${projStats.n} graded · mean projection error ${round1(projStats.absErr / (projStats.n * 2))} pts per player · real gap minus projected gap ${round1(projStats.gapCaptured / projStats.n)} pts on average`)
    for (const [bucket, b] of [...projBuckets].sort()) console.log(`  ${bucket.padEnd(18)} ${b.n} calls, ${pct(b.right, b.n)} right, avg ${round1(b.margin / b.n)} pts gained`)
  }
  /*
   * Waiver adds (2026-11-15): the waiver panel's #1 pickup and Chimmy's chat adds. A free agent has no
   * league score row until someone rosters him, so adds are graded on the league-independent week-stats
   * feed instead (`player_game_stats`, keyed by Sleeper id): standard PPR from `pts_ppr`, or the row's
   * own points when it was scored — never a row marked scored=false, whose 0 is a default. Over the
   * advice week and the two after it; a window not yet played is pending.
   */
  const ADD_WINDOW = 3
  const adds = await prisma.$queryRaw`
    WITH pts AS (
      SELECT "playerId" AS pid, "weekOrRound" AS wk,
             SUM(COALESCE((normalized_stat_map->>'pts_ppr')::float8,
                          CASE WHEN normalized_stat_map->>'scored' = 'false' THEN NULL ELSE "fantasyPoints" END)) AS p
      FROM player_game_stats
      WHERE "sportType" IN ('NFL', 'nfl') AND season = ${season}
      GROUP BY 1, 2
    )
    SELECT a.surface, a.week,
           (SELECT SUM(p) FROM pts WHERE pid = a.rec_player_key AND wk BETWEEN a.week AND a.week + ${ADD_WINDOW - 1}) AS rec_pts,
           (SELECT COUNT(*)::int FROM pts WHERE pid = a.rec_player_key AND wk BETWEEN a.week AND a.week + ${ADD_WINDOW - 1}) AS rec_weeks,
           (SELECT SUM(p) FROM pts WHERE a.alt_player_key <> '' AND pid = a.alt_player_key AND wk BETWEEN a.week AND a.week + ${ADD_WINDOW - 1}) AS alt_pts,
           a.alt_player_key <> '' AS has_drop
    FROM chimmy_advice a
    WHERE a.advice_type = 'add' AND a.season = ${season}`
  const addBy = new Map()
  for (const r of adds) {
    const s = addBy.get(r.surface) ?? { calls: 0, pending: 0, noStats: 0, graded: 0, pts: 0, startable: 0, vsDrop: 0, beatDrop: 0, lostDrop: 0, dropMargin: 0 }
    addBy.set(r.surface, s)
    s.calls++
    if (Number(r.week) + ADD_WINDOW - 1 > through) { s.pending++; continue }
    if (!Number(r.rec_weeks)) { s.noStats++; continue }
    const rec = Number(r.rec_pts ?? 0)
    s.graded++
    s.pts += rec
    if (rec / ADD_WINDOW >= 10) s.startable++
    if (r.has_drop) {
      const alt = Number(r.alt_pts ?? 0)
      s.vsDrop++
      if (rec > alt) s.beatDrop++
      else if (rec < alt) s.lostDrop++
      s.dropMargin += rec - alt
    }
  }
  console.log(`\nWaiver adds, graded on standard PPR over the advice week and the next ${ADD_WINDOW - 1} (not each league's scoring):`)
  if (!addBy.size) console.log('  (none)')
  for (const [surface, s] of [...addBy].sort((a, b) => b[1].calls - a[1].calls)) {
    const drop = s.vsDrop ? ` · vs the suggested drop: better ${s.beatDrop} / worse ${s.lostDrop} of ${s.vsDrop}, avg ${round1(s.dropMargin / s.vsDrop)} pts over the window` : ''
    console.log(`  ${surface.padEnd(22)} ${String(s.calls).padStart(5)} adds · graded ${s.graded}: avg ${s.graded ? round1(s.pts / s.graded / ADD_WINDOW) : '-'} PPR/week, ${pct(s.startable, s.graded)} averaged 10+${drop} · pending ${s.pending} · no stat rows ${s.noStats}`)
  }

  console.log('\nPaste everything above back. It contains counts and points only.')
} catch (err) {
  console.error('advice-ledger-report failed:', err instanceof Error ? err.message.split('\n').slice(-1)[0] : err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
