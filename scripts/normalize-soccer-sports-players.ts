/**
 * One-time SOCCER SportsPlayer normalization.
 *
 * Background — see memory entry "SOCCER ingestion blocks resolver pool".
 * Two distinct writer paths feed `SportsPlayer` rows tagged sport=SOCCER:
 *   - lib/api-football.ts  → position via `normalizePosition` (NFL-only canonical
 *                            map → unmapped soccer codes pass through uppercased)
 *   - scripts/sync-thesportsdb-players.ts → raw `player.strPosition` ("Midfielder",
 *                                            "Defender", "Forward", "Goalkeeper")
 *
 * On top of that, some rows are tagged sport=SOCCER but carry baseball positions
 * (1B, 2B, OF, …) and non-soccer teams (e.g. "TAMPA BAY RAYS") — cross-sport
 * contamination. Until the writers are fixed, this script normalizes existing
 * rows so the draft pool resolver returns a non-empty pool for SOCCER:
 *
 *   1. Map full-form positions to short canonical codes
 *      (Midfielder→MID, Defender→DEF, Forward→FWD, Goalkeeper→GK, Attacker→FWD).
 *   2. Delete rows whose normalized position isn't a soccer position
 *      (i.e. cross-sport contamination — keeps the row count honest rather than
 *      poisoning queries with stale baseball/football data tagged SOCCER).
 *
 * Defaults to dry-run. Pass `--apply` to actually update/delete.
 *
 *   node --env-file=.env --import tsx scripts/normalize-soccer-sports-players.ts
 *   node --env-file=.env --import tsx scripts/normalize-soccer-sports-players.ts --apply
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SOCCER_POSITION_MAP: Record<string, string> = {
  goalkeeper: 'GK',
  goalie: 'GK',
  gk: 'GK',
  g: 'GK',
  defender: 'DEF',
  defence: 'DEF',
  defense: 'DEF',
  def: 'DEF',
  d: 'DEF',
  midfielder: 'MID',
  midfield: 'MID',
  mid: 'MID',
  m: 'MID',
  forward: 'FWD',
  attacker: 'FWD',
  striker: 'FWD',
  fwd: 'FWD',
  f: 'FWD',
}

/** Returns the canonical SOCCER short code or null when the input isn't a soccer position. */
function canonicalSoccerPosition(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return null
  return SOCCER_POSITION_MAP[v] ?? null
}

interface CliOpts {
  apply: boolean
  json: boolean
}

function parseCli(argv: string[]): CliOpts {
  const out: CliOpts = { apply: false, json: false }
  for (const a of argv) {
    if (a === '--apply') out.apply = true
    else if (a === '--json') out.json = true
  }
  return out
}

async function run() {
  const opts = parseCli(process.argv.slice(2))
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport: { equals: 'SOCCER', mode: 'insensitive' } },
    select: { id: true, position: true, team: true, name: true, source: true },
  })

  const updates: Array<{ id: string; canonical: string; from: string }> = []
  const deletions: Array<{ id: string; reason: string; sample: { name: string; position: string; team: string | null } }> = []
  const positionHistogram: Record<string, number> = {}

  for (const row of rows) {
    positionHistogram[row.position ?? '(null)'] = (positionHistogram[row.position ?? '(null)'] ?? 0) + 1

    const canonical = canonicalSoccerPosition(row.position)
    if (canonical) {
      if (canonical !== row.position) {
        updates.push({ id: row.id, canonical, from: row.position ?? '(null)' })
      }
    } else {
      // Cross-sport contamination: position isn't a recognised soccer code.
      deletions.push({
        id: row.id,
        reason: 'non-soccer position',
        sample: { name: row.name, position: row.position ?? '(null)', team: row.team },
      })
    }
  }

  const summary = {
    mode: opts.apply ? 'apply' : 'dry-run',
    totalRows: rows.length,
    positionHistogram,
    updates: updates.length,
    deletions: deletions.length,
    sampleUpdates: updates.slice(0, 5),
    sampleDeletions: deletions.slice(0, 5),
    appliedUpdates: 0,
    appliedDeletions: 0,
  }

  if (opts.apply) {
    // Group updates by canonical code so we can use updateMany for fewer round trips.
    const byCanonical = new Map<string, string[]>()
    for (const u of updates) {
      const list = byCanonical.get(u.canonical) ?? []
      list.push(u.id)
      byCanonical.set(u.canonical, list)
    }
    for (const [canonical, ids] of byCanonical.entries()) {
      const result = await prisma.sportsPlayer.updateMany({
        where: { id: { in: ids } },
        data: { position: canonical },
      })
      summary.appliedUpdates += result.count
    }

    if (deletions.length > 0) {
      const result = await prisma.sportsPlayer.deleteMany({
        where: { id: { in: deletions.map((d) => d.id) } },
      })
      summary.appliedDeletions = result.count
    }
  }

  if (opts.json) console.log(JSON.stringify(summary, null, 2))
  else {
    console.log(`mode:                ${summary.mode}`)
    console.log(`total SOCCER rows:   ${summary.totalRows}`)
    console.log(`updates needed:      ${summary.updates}`)
    console.log(`deletions needed:    ${summary.deletions}`)
    if (opts.apply) {
      console.log(`updates applied:     ${summary.appliedUpdates}`)
      console.log(`deletions applied:   ${summary.appliedDeletions}`)
    } else {
      console.log('(dry-run — pass --apply to commit)')
    }
    console.log('\nposition histogram:')
    const sortedPositions = Object.entries(summary.positionHistogram).sort((a, b) => b[1] - a[1])
    for (const [pos, count] of sortedPositions.slice(0, 20)) {
      console.log(`  ${pos.padEnd(20)} ${count}`)
    }
  }

  await prisma.$disconnect()
}

run().catch((err) => { console.error(err); process.exit(1) })

export { canonicalSoccerPosition, SOCCER_POSITION_MAP }
