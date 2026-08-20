/**
 * Backfill `league_player_weekly_scores` from Sleeper, for imported leagues.
 *
 * Run AFTER `20260820120000_league_player_weekly_scores` has been applied to the
 * target database. Without the table this exits on the first write with P2021,
 * which is the correct failure — it should not create anything itself.
 *
 * ⚠ MANUAL ONLY, AND DELIBERATELY NOT A CRON. Wiring this into
 * `/api/cron/fantasy-os-exec-sync` (its eventual home — that cron already
 * enumerates canonical imported Sleeper leagues on a season-aware cadence) is a
 * separate change that must land only once the migration is on production.
 * Vercel preview shares the production database, so a live cron querying a table
 * that does not exist there would emit P2021 every 30 minutes.
 *
 * ⚠ DRY RUN BY DEFAULT. Writing requires --commit. The dry run performs every
 * provider fetch and reports exactly what it would upsert, so the shape of a run
 * is knowable before any row is written.
 *
 * Usage:
 *   npx tsx scripts/backfill-sleeper-player-scores.ts                  # dry run, all leagues
 *   npx tsx scripts/backfill-sleeper-player-scores.ts --commit
 *   npx tsx scripts/backfill-sleeper-player-scores.ts --league=<id> --weeks=1-14
 *   npx tsx scripts/backfill-sleeper-player-scores.ts --season=2026 --commit
 */
import { prisma } from '../lib/prisma'
import { ingestSleeperPlayerScoresForWeek } from '../lib/sleeper/sync/ingestSleeperPlayerScores'

const { describeTarget, isProductionTarget } = require('./db-target-identity.cjs') as {
  describeTarget: (url: string) => string
  isProductionTarget: (url: string) => boolean
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const COMMIT = process.argv.includes('--commit')

/** "1-14" or "12" → [1..14] / [12]. Defaults to a full NFL regular season. */
function parseWeeks(spec: string | null): number[] {
  if (!spec) return Array.from({ length: 18 }, (_, i) => i + 1)
  if (spec.includes('-')) {
    const [a, b] = spec.split('-').map((n) => Number(n))
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) {
      throw new Error(`--weeks=${spec} is not a range I can read`)
    }
    return Array.from({ length: b - a + 1 }, (_, i) => a + i)
  }
  const one = Number(spec)
  if (!Number.isFinite(one)) throw new Error(`--weeks=${spec} is not a week`)
  return [one]
}

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  /*
   * ⚠ THE TARGET IS PRINTED BEFORE ANYTHING RUNS, AND PRODUCTION IS NAMED AS
   * SUCH. This repo has had a script guard that was inverted — it refused the
   * safe database and let production through — so the rule here is to state the
   * target plainly and let the operator confirm, rather than to be clever about
   * deciding for them.
   */
  console.log(`DB target : ${describeTarget(url)}`)
  console.log(`Mode      : ${COMMIT ? 'COMMIT (will write)' : 'DRY RUN (no writes)'}`)
  if (isProductionTarget(url) && COMMIT) {
    console.log('⚠ This is PRODUCTION and --commit is set. Ctrl-C now if that is not intended.')
    await new Promise((r) => setTimeout(r, 5000))
  }

  const leagueFilter = arg('league')
  const seasonArg = arg('season')
  const weeks = parseWeeks(arg('weeks'))

  /*
   * Only leagues that came from Sleeper. `platformLeagueId` is a non-null String
   * on this model — an earlier version filtered `{ not: null }`, which Prisma
   * rejects outright on a required field — so the id space is guaranteed and the
   * only real filter is the platform.
   *
   * That id is the SLEEPER league id, the same space `weekly_matchups.leagueId`
   * and `league_player_weekly_scores.leagueId` use, so no translation is needed.
   */
  const leagues = await prisma.league.findMany({
    where: {
      platform: 'sleeper',
      ...(leagueFilter ? { platformLeagueId: leagueFilter } : {}),
    },
    select: { id: true, name: true, platformLeagueId: true, season: true },
  })

  console.log(`Leagues   : ${leagues.length}`)
  console.log(`Weeks     : ${weeks[0]}–${weeks[weeks.length - 1]}`)
  console.log('')

  let totalWould = 0
  let totalWritten = 0
  let leaguesTouched = 0
  const failures: Array<{ league: string; week: number; error: string }> = []

  for (const lg of leagues) {
    const platformLeagueId = lg.platformLeagueId as string
    const season = Number(seasonArg ?? lg.season)
    if (!Number.isFinite(season)) {
      failures.push({ league: platformLeagueId, week: 0, error: 'no resolvable season' })
      continue
    }

    let leagueRows = 0
    for (const week of weeks) {
      if (!COMMIT) {
        /*
         * The dry run still fetches, because the point is to learn how many rows
         * a real run would touch and whether the provider answers at all. It just
         * never writes.
         */
        const { getLeagueMatchups } = await import('../lib/sleeper-client')
        try {
          const ms = await getLeagueMatchups(platformLeagueId, week)
          for (const m of ms ?? []) {
            const scored =
              (Number(m.points) || 0) > 0 ||
              (Array.isArray(m.starters_points) && m.starters_points.some((p) => p > 0))
            if (!scored) continue
            const ids = Object.keys(m.players_points ?? {}).filter((id) => id && id !== '0')
            leagueRows += ids.length
          }
        } catch (e) {
          failures.push({
            league: platformLeagueId,
            week,
            error: e instanceof Error ? e.message : String(e),
          })
        }
        continue
      }

      const r = await ingestSleeperPlayerScoresForWeek(platformLeagueId, season, week)
      if (r.error) failures.push({ league: platformLeagueId, week, error: r.error })
      leagueRows += r.scoresUpserted
    }

    if (leagueRows > 0) {
      leaguesTouched += 1
      console.log(`  ${lg.name ?? platformLeagueId}: ${leagueRows} rows`)
    }
    if (COMMIT) totalWritten += leagueRows
    else totalWould += leagueRows
  }

  console.log('')
  console.log(COMMIT ? `WROTE     : ${totalWritten} rows` : `WOULD WRITE: ${totalWould} rows`)
  console.log(`Leagues with data: ${leaguesTouched} of ${leagues.length}`)
  if (failures.length) {
    console.log(`Failures  : ${failures.length}`)
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${f.league} wk${f.week}: ${f.error}`)
    }
    if (failures.length > 10) console.log(`  …and ${failures.length - 10} more`)
  }
  if (!COMMIT) console.log('\nNothing was written. Re-run with --commit to apply.')
}

main()
  .catch((e) => {
    console.error('FAILED:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
