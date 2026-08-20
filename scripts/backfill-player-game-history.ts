/**
 * Multi-season backfill of NFL player game stats, WITH opponent context.
 *
 * Drives the existing importPlayerGameStatsForWeek pipeline — the same path the
 * daily cron uses — rather than a parallel importer, so normalization, fantasy
 * point computation and the week ledger stay identical to steady-state ingest.
 *
 * Why this exists: opponent-aware projections need a player's history against a
 * specific defense. One season gives n=1–2 per opponent, which is noise. Several
 * seasons give a divisional matchup n=6–10, which is signal.
 *
 *   npx tsx scripts/backfill-player-game-history.ts 2019 2024
 *
 * Idempotent — re-running re-upserts the same rows.
 */
import {
  SleeperWeeklyStatsFetcher,
  importPlayerGameStatsForWeek,
  loadKnownNflPlayerIds,
} from '../lib/player-game-stats/importPlayerGameStats'

const from = Number(process.argv[2] ?? 2019)
const to = Number(process.argv[3] ?? 2024)
const WEEKS = 18

async function main() {
  const fetcher = new SleeperWeeklyStatsFetcher()
  const known = await loadKnownNflPlayerIds()
  console.log(`known NFL player ids: ${known.size}`)
  console.log(`backfilling ${from}–${to}, ${WEEKS} weeks each\n`)

  for (let season = from; season <= to; season++) {
    let seasonRows = 0
    let seasonFailed = 0
    for (let week = 1; week <= WEEKS; week++) {
      try {
        const report = await importPlayerGameStatsForWeek({
          season,
          week,
          fetcher,
          knownPlayerIds: known,
          // Facts regeneration is a separate, heavier pass; this backfill is about
          // getting opponent-stamped stats on disk.
          generateFacts: false,
        })
        seasonRows += report.ingested ?? 0
        process.stdout.write(`  ${season} w${String(week).padStart(2)} -> ${report.ingested ?? 0}\n`)
      } catch (e) {
        seasonFailed++
        process.stdout.write(`  ${season} w${String(week).padStart(2)} -> FAILED ${(e as Error).message.slice(0, 60)}\n`)
      }
    }
    console.log(`${season}: ${seasonRows} rows, ${seasonFailed} failed weeks\n`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
