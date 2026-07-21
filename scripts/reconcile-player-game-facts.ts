/**
 * Reconcile PlayerGameStat ↔ PlayerGameFact for a season.
 *
 * Detects weeks whose facts are missing, mismatched, duplicated, or orphaned (regeneration is
 * a pure function of the stat rows, so one repair path covers every drift shape) and repairs
 * ONLY those weeks — healthy weeks are never touched, stats are never modified.
 *
 * Usage:
 *   npx tsx scripts/reconcile-player-game-facts.ts --season 2025                # dry run (default)
 *   npx tsx scripts/reconcile-player-game-facts.ts --season 2025 --apply
 *   npx tsx scripts/reconcile-player-game-facts.ts --season 2025 --week 16 --apply
 *   flags: --season N (required)  --week N  --apply  --max-repairs N
 *
 * Verification SQL (after --apply):
 *   SELECT s."weekOrRound", COUNT(*) AS stats,
 *          (SELECT COUNT(*) FROM dw_player_game_facts f
 *            WHERE f.sport='NFL' AND f.season=s.season AND f."weekOrRound"=s."weekOrRound") AS facts
 *   FROM player_game_stats s WHERE s."sportType"='NFL' AND s.season=<season>
 *   GROUP BY s.season, s."weekOrRound" ORDER BY s."weekOrRound";
 *   -- every row must show stats = facts
 */

import fs from 'node:fs'

for (const f of ['.env', '.env.local']) {
  try {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) {
        let v = m[2].trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        process.env[m[1]] = v
      }
    }
  } catch {}
}

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const seasonIdx = args.indexOf('--season')
const SEASON = seasonIdx >= 0 ? Number(args[seasonIdx + 1]) : NaN
const weekIdx = args.indexOf('--week')
const WEEK = weekIdx >= 0 ? Number(args[weekIdx + 1]) : undefined
const maxIdx = args.indexOf('--max-repairs')
const MAX = maxIdx >= 0 ? Number(args[maxIdx + 1]) : undefined

async function main() {
  if (!Number.isFinite(SEASON)) {
    console.error('--season <year> is required')
    process.exit(1)
  }
  const { reconcilePlayerGameFacts } = await import('../lib/player-game-stats/importPlayerGameStats')
  const report = await reconcilePlayerGameFacts({
    season: SEASON,
    ...(Number.isFinite(WEEK ?? NaN) ? { week: WEEK } : {}),
    dryRun: !APPLY,
    ...(Number.isFinite(MAX ?? NaN) ? { maxRepairs: MAX } : {}),
  })
  console.log(`[reconcile] ${APPLY ? 'APPLIED' : 'DRY RUN'} season=${SEASON}`)
  console.log(JSON.stringify(report, null, 2))
  if (!APPLY && report.weeks.some((w) => w.action === 'would_repair')) {
    console.log('\nRe-run with --apply to repair the weeks marked would_repair.')
  }
  process.exit(report.failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
