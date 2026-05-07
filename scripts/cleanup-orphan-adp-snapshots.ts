/**
 * Safe cleanup of orphan AllFantasyAdpSnapshot rows after a `playerKey` migration.
 *
 * Background: when the writer's playerKey normalization changed, the upsert key
 * `(playerKey, contextHash, draftMode)` started writing NEW rows alongside the OLD
 * rows because the playerKey itself was different. The resolver only matches the
 * new shape, so the old rows are dead weight (still queryable, never returned).
 *
 * This script finds rows whose stored `playerKey` doesn't match what the current
 * canonical helper would produce for `(playerName, position-extracted-from-old-key)`,
 * and deletes them.
 *
 * Defaults to dry-run. Pass `--apply` to actually delete.
 *
 *   node --env-file=.env --import tsx scripts/cleanup-orphan-adp-snapshots.ts
 *   node --env-file=.env --import tsx scripts/cleanup-orphan-adp-snapshots.ts --apply
 *   node --env-file=.env --import tsx scripts/cleanup-orphan-adp-snapshots.ts --apply --sport=NFL --season=2026
 */

import { PrismaClient } from '@prisma/client'
import { buildAllFantasyAdpPlayerKey } from '@/lib/adp/playerKey'

interface CliOptions {
  apply: boolean
  sport: string | null
  season: string | null
  json: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { apply: false, sport: null, season: null, json: false }
  for (const arg of argv) {
    if (arg === '--apply') out.apply = true
    else if (arg === '--json') out.json = true
    else if (arg.startsWith('--sport=')) out.sport = arg.slice('--sport='.length).trim() || null
    else if (arg.startsWith('--season=')) out.season = arg.slice('--season='.length).trim() || null
  }
  return out
}

async function run() {
  const opts = parseArgs(process.argv.slice(2))
  const prisma = new PrismaClient()

  const where: { sport?: string; season?: string } = {}
  if (opts.sport) where.sport = opts.sport.toUpperCase()
  if (opts.season) where.season = opts.season

  const rows = await prisma.allFantasyAdpSnapshot.findMany({
    where,
    select: { id: true, sport: true, season: true, playerName: true, playerKey: true, contextHash: true, draftMode: true },
  })

  const orphans: typeof rows = []
  for (const row of rows) {
    const positionFromKey = (row.playerKey.split('|')[1] ?? '').trim()
    const canonical = buildAllFantasyAdpPlayerKey({ name: row.playerName, position: positionFromKey })
    if (canonical !== row.playerKey) orphans.push(row)
  }

  const summary = {
    mode: opts.apply ? 'apply' : 'dry-run',
    filter: { sport: where.sport ?? 'all', season: where.season ?? 'all' },
    totalRows: rows.length,
    orphanRows: orphans.length,
    samples: orphans.slice(0, 8).map((r) => ({
      playerName: r.playerName,
      storedKey: r.playerKey,
      canonicalKey: buildAllFantasyAdpPlayerKey({
        name: r.playerName,
        position: (r.playerKey.split('|')[1] ?? '').trim(),
      }),
      sport: r.sport,
      season: r.season,
      draftMode: r.draftMode,
    })),
    deleted: 0,
  }

  if (opts.apply && orphans.length > 0) {
    const result = await prisma.allFantasyAdpSnapshot.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    })
    summary.deleted = result.count
  }

  if (opts.json) console.log(JSON.stringify(summary, null, 2))
  else {
    console.log(`mode:        ${summary.mode}`)
    console.log(`filter:      sport=${summary.filter.sport} season=${summary.filter.season}`)
    console.log(`totalRows:   ${summary.totalRows}`)
    console.log(`orphanRows:  ${summary.orphanRows}`)
    if (summary.samples.length > 0) {
      console.log('samples:')
      for (const s of summary.samples) {
        console.log(`  - "${s.playerName}" stored="${s.storedKey}" canonical="${s.canonicalKey}"`)
      }
    }
    if (opts.apply) console.log(`deleted:     ${summary.deleted}`)
    else if (summary.orphanRows > 0) console.log('(dry-run — pass --apply to delete)')
  }

  await prisma.$disconnect()
}

run().catch((e) => { console.error(e); process.exit(1) })
