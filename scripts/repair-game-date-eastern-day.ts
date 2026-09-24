/**
 * Repair `player_game_stats.game_date` rows written before the writers stored the US Eastern DAY.
 * Dry by default; writes only with `--apply --host=<the host it prints>`.
 *
 *   npx tsx scripts/repair-game-date-eastern-day.ts                      # dry, writes nothing
 *   npx tsx scripts/repair-game-date-eastern-day.ts --apply --host=ep-…  # writes
 *
 * WHAT IT FIXES. Both writers stored the kickoff INSTANT and Postgres kept its UTC date, so every
 * US game from 8pm Eastern on was dated the next day (see lib/sports-data/easternGameDay.ts).
 * Measured on production 2026-09-24:
 *
 *   NCAAB 60,439 · MLB 16,526 · NCAAF 4,011 · NHL 382 rows one day late · SOCCER 0 · NFL untouched
 *
 * THE RULE IT APPLIES IS THE WRITER'S, so a repaired row equals what a re-ingest would write:
 *   - Rolling Insights rows: the day in `provider_game_id` (`YYYYMMDD-{away}-{home}`, GAPS G-08).
 *   - CFBD rows (`gameId` `cfbd:<id>`): the Eastern date of that game's `SportsGame.startTime`
 *     (source 'cfbd', newest fetch — a fixture can carry several rows).
 * Only rows whose date DIFFERS are touched, and only a date is changed. Re-running is a no-op.
 *
 * ⚠ It reads and writes whatever `DATABASE_URL` names — in this repo `.env` is PRODUCTION. The host
 * is printed first, and `--apply` refuses unless `--host=` repeats it, so a copied command cannot
 * land on a database nobody looked at.
 *
 * ⚠ The UPDATEs run in one transaction and are checked against the dry-run counts before commit:
 * any difference rolls everything back. `scripts/` is excluded from tsconfig.
 */

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const hostArg = args.find((a) => a.startsWith('--host='))?.split('=')[1] ?? null

function hostOf(url: string | undefined): string {
  const u = String(url ?? '')
  return u.includes('@') ? (u.split('@')[1]?.split('/')[0]?.split('?')[0] ?? '(unparsed)') : '(unset)'
}

/* Kept as SQL fragments so the count and the UPDATE can never disagree about which rows. */
const RI_TARGET = `
  FROM player_game_stats p
  WHERE p.source = 'rolling_insights_live'
    AND p.provider_game_id ~ '^[0-9]{8}-'
    AND p.game_date IS DISTINCT FROM to_date(left(p.provider_game_id, 8), 'YYYYMMDD')`

const CFBD_GAMES = `
  SELECT DISTINCT ON ("externalId") "externalId",
         (("startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')::date AS et_day
  FROM "SportsGame"
  WHERE sport = 'NCAAF' AND source = 'cfbd' AND "startTime" IS NOT NULL
  ORDER BY "externalId", "fetchedAt" DESC NULLS LAST`

const CFBD_TARGET = `
  FROM player_game_stats p
  JOIN (${CFBD_GAMES}) g ON g."externalId" = substr(p."gameId", 6)
  WHERE p."sportType" = 'NCAAF' AND p."gameId" LIKE 'cfbd:%'
    AND p.game_date IS DISTINCT FROM g.et_day`

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const host = hostOf(process.env.DATABASE_URL)
  console.log(apply ? 'APPLY — this will UPDATE game_date.' : 'DRY RUN — nothing will be written.')
  console.log(`  database host  ${host}`)

  const count = async (target: string) =>
    prisma.$queryRawUnsafe<Array<{ sport: string; rows: number; games: number }>>(
      `SELECT p."sportType" AS sport, count(*)::int AS rows, count(DISTINCT p."gameId")::int AS games ${target} GROUP BY 1 ORDER BY 1`,
    )
  const ri = await count(RI_TARGET)
  const cfbd = await count(CFBD_TARGET)
  const riTotal = ri.reduce((a, r) => a + r.rows, 0)
  const cfbdTotal = cfbd.reduce((a, r) => a + r.rows, 0)
  for (const r of [...ri, ...cfbd]) console.log(`  ${r.sport.padEnd(7)} ${String(r.rows).padStart(7)} rows  ${String(r.games).padStart(5)} game ids to re-date`)
  console.log(`  total          ${riTotal + cfbdTotal} rows`)

  if (!apply) {
    console.log('\nDry run only. To write, repeat with:  --apply --host=' + host)
    return
  }
  if (hostArg !== host) {
    console.log(`\nREFUSED: --host=${hostArg ?? '(missing)'} does not match the database host ${host}.`)
    process.exitCode = 1
    return
  }

  await prisma.$transaction(async (tx) => {
    const riDone = await tx.$executeRawUnsafe(
      `UPDATE player_game_stats AS t SET game_date = to_date(left(t.provider_game_id, 8), 'YYYYMMDD')
       WHERE t.id IN (SELECT p.id ${RI_TARGET})`,
    )
    const cfbdDone = await tx.$executeRawUnsafe(
      `UPDATE player_game_stats AS t SET game_date = g.et_day
       FROM (${CFBD_GAMES}) g
       WHERE g."externalId" = substr(t."gameId", 6) AND t.id IN (SELECT p.id ${CFBD_TARGET})`,
    )
    console.log(`  updated        RI ${riDone} · CFBD ${cfbdDone}`)
    if (riDone !== riTotal || cfbdDone !== cfbdTotal) {
      throw new Error(`row counts moved between count and update (RI ${riDone}/${riTotal}, CFBD ${cfbdDone}/${cfbdTotal}) — rolled back`)
    }
    const [left] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT ((SELECT count(*) ${RI_TARGET}) + (SELECT count(*) ${CFBD_TARGET}))::int AS n`,
    )
    if (left.n !== 0) throw new Error(`${left.n} rows still differ after the update — rolled back`)
  }, { timeout: 600_000, maxWait: 30_000 })
  console.log('  committed; 0 rows differ.')
}

main()
  .catch((e) => {
    console.error('FAILED:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(async () => {
    const { prisma } = await import('@/lib/prisma')
    await prisma.$disconnect()
  })
