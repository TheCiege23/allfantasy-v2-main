/**
 * T9 — controlled recalculation of official AllFantasy market values.
 *
 * DRY-RUN BY DEFAULT. Pass `--write` to persist. Writes ONLY the AllFantasy market value tables +
 * audit rows; never touches provider / projection / ADP / snapshot data; no env edits; no external
 * APIs. Logs a summary only.
 *
 *   node --env-file=.env --import tsx scripts/recalculate-allfantasy-market-values.ts            # dry-run
 *   node --env-file=.env --import tsx scripts/recalculate-allfantasy-market-values.ts --write     # persist
 *   node --env-file=.env --import tsx scripts/recalculate-allfantasy-market-values.ts --sport NCAAF
 */

import { PrismaClient } from '@prisma/client'
import { recalculateOfficialMarketValues } from '../lib/trade-market/allFantasyMarketValues'

const prisma = new PrismaClient()

async function main() {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const sportArg = args[args.indexOf('--sport') + 1]
  const sports = sportArg && args.includes('--sport') ? [sportArg] : ['NFL', 'NCAAF']

  const results = []
  for (const sport of sports) {
    results.push(await recalculateOfficialMarketValues(sport, { dryRun: !write }))
  }
  console.log(JSON.stringify({ mode: write ? 'WRITE' : 'DRY-RUN', results }, null, 2))
  if (!write) console.log('\nDry-run only — no rows written. Re-run with --write to persist.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
