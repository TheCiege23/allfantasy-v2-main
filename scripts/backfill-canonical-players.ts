/**
 * Phase 2 — backfill canonical `Player` / `Team` from `SportsPlayer` / `SportsTeam`.
 *
 * Thin CLI over `lib/canonical/backfillCanonical.ts` so the logic stays testable and the
 * matching-key decision lives in one place (`lib/canonical/canonicalIdentity.ts`).
 *
 * Idempotent: canonical ids are derived deterministically, so re-running picks up new source
 * rows without duplicating existing canonical players.
 *
 * Usage:
 *   tsx scripts/backfill-canonical-players.ts [--sport NFL] [--limit 5000] [--dry-run]
 */

import { prisma } from '@/lib/prisma'
import { backfillCanonicalPlayers } from '@/lib/canonical/backfillCanonical'

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 && process.argv[idx + 1] ? String(process.argv[idx + 1]) : fallback
}

async function main() {
  const sport = arg('sport')
  const limitRaw = arg('limit')
  const dryRun = process.argv.includes('--dry-run')

  const started = Date.now()
  const summary = await backfillCanonicalPlayers({
    sport,
    limit: limitRaw ? Number(limitRaw) : undefined,
    dryRun,
  })

  console.log('\n=== Phase 2 canonical backfill ===')
  console.log(`  sport                : ${sport ?? 'ALL'}${dryRun ? '  (DRY RUN)' : ''}`)
  console.log(`  source rows read     : ${summary.sourceRows}`)
  console.log(`  canonical players    : ${summary.canonicalPlayers}`)
  console.log(`  canonical teams      : ${summary.canonicalTeams}`)
  console.log(`  duplicates collapsed : ${summary.collapsedDuplicates}`)
  console.log(`  player identities    : ${summary.playerIdentities}`)
  console.log(`  team identities      : ${summary.teamIdentities}`)
  console.log(`  matched by sleeperId      : ${summary.strategies.sleeper_id}`)
  console.log(`  matched by name+pos+team  : ${summary.strategies.name_sport_position_team}`)
  console.log(`  duration             : ${Date.now() - started}ms`)
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0) })
  .catch(async (e) => { console.error('Fatal:', e); await prisma.$disconnect(); process.exit(1) })
