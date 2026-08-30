/**
 * D.5-test / D.5-scheduler — recompute AllFantasy AI ADP snapshots from
 * DraftPick rows.
 *
 * Thin CLI wrapper around `lib/adp/recomputeAllFantasyAdp.ts` (the reusable
 * service the daily Vercel cron route also calls — single source of truth for
 * aggregation + upsert math).
 *
 * USAGE
 *   npm run recompute:allfantasy-adp                                    # dry-run, real mode, NFL
 *   npm run recompute:allfantasy-adp -- --apply
 *   npm run recompute:allfantasy-adp -- --apply --include-test          # writes draftMode='test' rows
 *   npm run recompute:allfantasy-adp -- --season=2025 --sport=NFL --apply
 *   npm run recompute:allfantasy-adp -- --draft-mode=mock --apply
 *
 * Filters (defaults match D.5 spec):
 *   - source NOT IN ('test_seed', 'undone', 'corrected', 'deleted')
 *   - assetType IN (null, 'player')   (rookie / devy / dispersal picks excluded)
 *   - the row is not a commissioner-cleared EMPTY slot
 *   - sport is matched through `league.sport`, NOT the nullable `DraftPick.sportType`
 */

/** server-only stub is loaded by scripts/_audit-preload.cjs (node --require). */

import { PrismaClient } from '@prisma/client'
import {
  recomputeAllFantasyAdp,
  type RecomputeAllFantasyAdpReport,
} from '../lib/adp/recomputeAllFantasyAdp'
import type { DraftMode } from '../lib/adp/computeAllFantasyAdp'

const prisma = new PrismaClient()

interface Args {
  apply: boolean
  json: boolean
  includeTest: boolean
  sport: string | null
  season: string | null
  leagueType: string | null
  draftType: string | null
  teamCount: number | null
  draftMode: DraftMode | 'all'
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    apply: false,
    json: false,
    includeTest: false,
    sport: null,
    season: null,
    leagueType: null,
    draftType: null,
    teamCount: null,
    // CLI default keeps the historical 'all' behavior (script users
    // commonly want every mode); the cron route narrows to 'real' explicitly.
    draftMode: 'all',
  }
  for (const raw of argv) {
    if (raw === '--apply') out.apply = true
    else if (raw === '--json') out.json = true
    else if (raw === '--include-test') out.includeTest = true
    else if (raw.startsWith('--sport=')) out.sport = raw.slice('--sport='.length).toUpperCase()
    else if (raw.startsWith('--season=')) out.season = raw.slice('--season='.length)
    else if (raw.startsWith('--league-type=')) out.leagueType = raw.slice('--league-type='.length)
    else if (raw.startsWith('--draft-type=')) out.draftType = raw.slice('--draft-type='.length)
    else if (raw.startsWith('--team-count=')) {
      const n = Number(raw.slice('--team-count='.length))
      if (Number.isFinite(n) && n > 0) out.teamCount = n
    } else if (raw.startsWith('--draft-mode=')) {
      const v = raw.slice('--draft-mode='.length).toLowerCase()
      if (v === 'real' || v === 'mock' || v === 'test' || v === 'all') out.draftMode = v
    }
  }
  return out
}

function printPretty(args: Args, report: RecomputeAllFantasyAdpReport): void {
  console.log('────────────────────────────────────────────────────────')
  console.log(' D.5 — Recompute AllFantasy AI ADP')
  console.log('────────────────────────────────────────────────────────')
  console.log(` Mode:                ${report.mode}`)
  console.log(
    ` Filters:             sport=${args.sport ?? '*'}  season=${args.season ?? '*'}  draftMode=${args.draftMode}  includeTest=${args.includeTest}`,
  )
  console.log('')
  console.log(` Picks scanned:       ${report.picksScanned}`)
  console.log(` Picks kept:          ${report.picksKept}`)
  console.log(`   filtered (source): ${report.filteredOutBySource}`)
  console.log(`   filtered (asset):  ${report.filteredOutByAsset}`)
  console.log(`   filtered (mode):   ${report.filteredOutByMode}`)
  console.log(`   filtered (empty):  ${report.filteredOutByEmptyRow}`)
  console.log('')
  console.log(` Imported drafts:     ${report.importedDraftsCovered} drafts, ${report.importedPicksKept} picks`)
  console.log(`   facts scanned:     ${report.importedFactsScanned}`)
  console.log(`   unresolved player: ${report.importedSkippedUnresolvedPlayer}`)
  console.log('')
  console.log(` Unique players:      ${report.uniquePlayers}`)
  console.log(` Unique contexts:     ${report.uniqueContexts}`)
  console.log(
    ` Snapshots:           ${Object.entries(report.byDraftMode)
      .map(([m, c]) => `${m}=${c}`)
      .join('  ')}`,
  )
  if (args.apply) console.log(` Snapshots written:   ${report.snapshotsWritten}`)
  if (report.errors.length) {
    console.log('')
    console.log(` Errors (${report.errors.length}):`)
    for (const e of report.errors.slice(0, 5)) console.log(`   ! ${e}`)
  }
  if (!args.apply) {
    console.log('')
    console.log(' [dry-run] Re-run with --apply to write snapshots.')
  }
  console.log('────────────────────────────────────────────────────────')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const report = await recomputeAllFantasyAdp({
    sport: args.sport,
    season: args.season,
    draftMode: args.draftMode,
    includeTest: args.includeTest,
    apply: args.apply,
    leagueType: args.leagueType,
    draftType: args.draftType,
    teamCount: args.teamCount,
  })

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printPretty(args, report)
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('[recompute-allfantasy-adp] failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})
