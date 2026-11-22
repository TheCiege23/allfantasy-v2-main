/**
 * The AllFantasy trade market, PER LEAGUE FORMAT, by hand. DRY-RUN BY DEFAULT.
 *
 *   npx tsx scripts/recalculate-af-format-markets.ts --since 2026                        # dry-run
 *   npx tsx scripts/recalculate-af-format-markets.ts --since 2026 --write --endpoint=<id> # persist
 *
 * The same rebuild the daily ADP cron runs (`lib/trade-market/formatMarkets.ts`): dynasty/redraft ×
 * 1QB/superflex, each trade measured on the chart its own league is graded on, each book centring-gated
 * on its own population, plus the lineup factor table. Use it to inspect a run, or to rebuild after a
 * fix without waiting for 09:00.
 *
 * ⚠ THIS REPLACES `recalculate-af-market-values-from-trades.ts` FOR ANYTHING THE GRADE READS. That
 * script still writes the single legacy `dynasty` market, which no request path reads any more.
 *
 * 🛑 `--write` REQUIRES `--endpoint=<id>` NAMING THE DATABASE YOU MEAN — the same positive allowlist as
 * the legacy script, for the same reason: `@prisma/client` loads `.env` on import and `.env` points at
 * production. The dry run prints the endpoint your connection resolves to; nothing here names one.
 *
 * Writes ONLY `AllFantasyMarketPlayerValue`, its audit table and one `SportsDataCache` row. Calls no
 * external API.
 */
import { PrismaClient } from '@prisma/client'

import { endpointFromDatabaseUrl, endpointMatches } from '../lib/db/databaseEndpoint'
import { recalculateFormatMarkets } from '../lib/trade-market/formatMarkets'
import { parseSinceSeason } from '../lib/trade-market/sinceSeasonArg'

const prisma = new PrismaClient()

async function main() {
  const write = process.argv.includes('--write')
  const sinceSeason = parseSinceSeason(process.argv.slice(2)) ?? new Date().getUTCFullYear()
  const url = process.env.DATABASE_URL
  const endpoint = endpointFromDatabaseUrl(url)
  const wantEndpoint = (process.argv.find((a) => a.startsWith('--endpoint=')) ?? '').split('=')[1] ?? ''

  console.log(`  endpoint: ${endpoint ?? '(unresolved)'}`)
  console.log(`  mode:     ${write ? 'WRITE' : 'DRY RUN (no writes)'}`)
  console.log(`  since:    ${sinceSeason}`)

  if (write && !endpointMatches(url, wantEndpoint)) {
    console.error(
      `\nREFUSING — --write requires --endpoint=${endpoint ?? '<id>'} to confirm you mean this database.` +
        (wantEndpoint ? `\nYou named "${wantEndpoint}"; the connection resolves to "${endpoint ?? '(unresolved)'}".` : ''),
    )
    process.exitCode = 1
    return
  }

  // ONE call: `dryRun` decides whether it may write, `requireCentred` whether each book will.
  const r = await recalculateFormatMarkets(prisma, { sinceSeason, dryRun: !write, requireCentred: true })

  console.log(`\ntrades used: ${r.tradesUsed}   skipped: ${JSON.stringify(r.skipped)}`)
  for (const b of r.books) {
    const verdict = b.published === 0 ? 'nothing to publish' : b.refused ? 'REFUSED (not centred)' : write ? `wrote ${b.written}` : 'would write'
    console.log(
      `  ${b.concept.padEnd(16)} trades ${String(b.tradesUsed).padStart(5)}  published ${String(b.published).padStart(4)}  ` +
        `median ${b.medianAdjustment?.toFixed(1) ?? 'n/a'}%  ${verdict}`,
    )
  }
  console.log(`\nlineup factors (since ${r.lineup.sinceSeason}):`)
  for (const f of r.lineup.factors) {
    console.log(`  ${f.position} ${f.bucket.padEnd(4)} x${f.factor.toFixed(3)}  ${f.published ? 'PUBLISHED' : 'withheld '}  ${f.note}`)
  }
  if (!write) console.log('\nDry-run only — nothing written. Re-run with --write --endpoint=<id> to persist.')
  if (r.books.some((b) => b.refused)) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
