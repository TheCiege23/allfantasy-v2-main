/**
 * Reconnect draft sessions to their Sleeper drafts.
 *
 *   npx tsx scripts/backfill-sleeper-draft-ids.ts [--limit 200]
 *
 * The import stored a league's draft SETTINGS and dropped `draft_id`, so
 * `DraftSession.sleeperDraftId` was never written and the mirror had nothing to find.
 * One request per league; only sessions that already exist are filled.
 *
 * Read the `leaguesWithoutSession` count in the output: those leagues cannot be given a
 * draft id because they have no draft session at all, and creating 48 of them is a
 * separate decision this script deliberately does not make.
 */
import { backfillSleeperDraftIds } from '../lib/sleeper/sync/backfillSleeperDraftIds'
import { prisma } from '../lib/prisma'

async function main() {
  const i = process.argv.indexOf('--limit')
  const maxLeagues = i >= 0 ? Number(process.argv[i + 1]) : 200

  const before = await prisma.draftSession.count({ where: { sleeperDraftId: { not: null } } })
  const result = await backfillSleeperDraftIds({ maxLeagues })
  const after = await prisma.draftSession.count({ where: { sleeperDraftId: { not: null } } })

  console.log(`sessions missing an id:  ${result.sessionsMissingId}`)
  console.log(`  resolved:              ${result.resolved}`)
  console.log(`  no draft upstream yet: ${result.noDraftUpstream}`)
  console.log(`  failed:                ${result.failed}`)
  console.log(`\nsleeper leagues with NO draft session at all: ${result.leaguesWithoutSession}`)
  console.log('  (this script cannot help those — they need a session first)')

  if (result.failures.length) {
    console.log('\nfailures:')
    for (const f of result.failures.slice(0, 10)) console.log(`  ${f.leagueId}  ${f.reason}`)
  }
  console.log(`\nlinked sessions: ${before} -> ${after}`)
  process.exit(result.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
