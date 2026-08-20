/**
 * Ingest everything TheSportsDB serves, for every sport AllFantasy supports.
 *
 *   npx tsx scripts/ingest-thesportsdb.ts --sports=NFL,NBA --no-rosters
 *   npx tsx scripts/ingest-thesportsdb.ts --stats --sports=NFL --max-players=100
 *
 * Rosters are the slow pass (one call per team) and stats the slowest (one call
 * per player), so both are opt-out / opt-in rather than always-on.
 */

import {
  LEAGUES,
  ingestSport,
  ingestSchedule,
  ingestPlayerStats,
  ingestLiveScores,
  type IngestSport,
} from '@/lib/sports-data/theSportsDbIngest'

const ALL = Object.keys(LEAGUES) as IngestSport[]

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const sports = (arg('sports')?.split(',').map((s) => s.trim().toUpperCase()) as IngestSport[] | undefined) ?? ALL
  const includeRosters = !flag('no-rosters')
  const doStats = flag('stats')
  const doLive = flag('live')
  const maxPlayers = Number.parseInt(arg('max-players') ?? '250', 10)

  const target = process.env.DATABASE_URL ?? ''
  const host = target.match(/@([^/.]+)/)?.[1] ?? 'unknown'
  process.stdout.write(`DB host: ${host}\nsports: ${sports.join(', ')}\nrosters: ${includeRosters}\n\n`)

  for (const sport of sports) {
    if (!LEAGUES[sport]) {
      process.stdout.write(`skip ${sport}: not a configured league\n`)
      continue
    }
    const started = Date.now()

    // `--season=` overrides the auto-detected one. Needed because auto-detection
    // reads the NEXT-events feed, which is correct for "what is coming up" but
    // means a league between seasons reports the barely-published upcoming one:
    // NBA returned 17 fixtures in August while the completed 2025-2026 season sat
    // un-ingested. Backfilling is a separate, explicit pass.
    const seasonOverride = arg('season')
    if (seasonOverride) {
      const sched = await ingestSchedule(sport, { season: seasonOverride })
      process.stdout.write(
        `${sport.padEnd(7)} season=${seasonOverride.padEnd(10)} games=${sched.written}/${sched.fetched}` +
          `  [${Math.round((Date.now() - started) / 1000)}s]\n`
      )
      continue
    }

    const s = await ingestSport(sport, { includeRosters })
    const secs = Math.round((Date.now() - started) / 1000)
    process.stdout.write(
      `${sport.padEnd(7)} season=${s.season.padEnd(10)} teams=${s.teams.written}/${s.teams.fetched}` +
        `  games=${s.schedule.written}/${s.schedule.fetched}` +
        `  players=${s.rosters.players}` +
        (s.note ? `  (${s.note})` : '') +
        `  [${secs}s]\n`
    )

    if (doStats) {
      const st = await ingestPlayerStats(sport, { maxPlayers })
      process.stdout.write(
        `        stats: queried=${st.playersQueried} withStats=${st.playersWithStats} seasonRows=${st.seasonRowsWritten}\n`
      )
    }
    if (doLive) {
      const lv = await ingestLiveScores(sport)
      process.stdout.write(`        live: received=${lv.received} updated=${lv.updated}\n`)
    }
  }

  process.stdout.write('\ndone\n')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stdout.write(`FAILED: ${e instanceof Error ? e.stack : String(e)}\n`)
    process.exit(1)
  })
