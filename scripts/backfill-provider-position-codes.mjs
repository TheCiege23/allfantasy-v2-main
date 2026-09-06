#!/usr/bin/env node
/*
 * Fold existing display-name positions in `SportsPlayer` to the codes the rest of the
 * column uses. Companion to the ingest fix in lib/sports-data/theSportsDbIngest.ts — that
 * stops new long-form rows arriving; this repairs the ones already stored.
 *
 * 🛑 DRY RUN BY DEFAULT. Writing needs --apply, and --apply needs --endpoint=<id> naming the
 * database you mean. Neither flag alone writes anything.
 *
 * 🛑 THE GUARD IS A POSITIVE ALLOWLIST, NOT A "not production" TEST. A host-substring guard
 * has been written inverted in this repo before, and an inverted negative guard points at
 * production. You name the endpoint you intend; a mismatch fails closed.
 *
 * Measured before writing (production, 2026-09-06):
 *     thesportsdb        143 short   2,081 long
 *     sleeper         11,718 short     242 long
 *     rolling_insights 9,521 short      40 long
 *
 * Usage:
 *     node scripts/backfill-provider-position-codes.mjs                      # dry run
 *     node scripts/backfill-provider-position-codes.mjs --apply --endpoint=ep-muddy-leaf-adigvvph
 */

import fs from 'node:fs'
import { providerPositionCode, isLongFormPosition } from '../lib/sports-data/providerPositionCode.ts'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const WANT = (args.find((a) => a.startsWith('--endpoint=')) ?? '').split('=')[1] ?? ''

function envFrom(file, key) {
  if (!fs.existsSync(file)) return null
  const l = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((x) => x.startsWith(key + '='))
  return l ? l.slice(key.length + 1).replace(/^["']|["']$/g, '') : null
}

const url = envFrom('.env.local', 'DATABASE_URL') || envFrom('.env', 'DATABASE_URL')
if (!url) { console.log('no DATABASE_URL'); process.exit(1) }
const endpoint = ((url.split('@')[1] || '').split('/')[0] || '').split('.')[0].replace(/-pooler$/, '')
console.log(`  endpoint: ${endpoint}`)
console.log(`  mode:     ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)

if (APPLY && endpoint !== WANT) {
  console.log(`  REFUSING — --apply requires --endpoint=${endpoint} to confirm you mean this database`)
  process.exit(1)
}

process.env.DATABASE_URL = url
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

const rows = await prisma.sportsPlayer.findMany({
  where: { position: { not: null } },
  select: { id: true, sport: true, source: true, position: true },
})

/* Only rows the table can actually fold. An unmapped position is left alone, never guessed. */
const changes = rows
  .filter((r) => isLongFormPosition(r.position, r.sport))
  .map((r) => ({ ...r, to: providerPositionCode(r.position, r.sport) }))
  .filter((r) => r.to && r.to !== r.position)

const bySource = new Map()
for (const c of changes) {
  const k = `${c.source} · ${c.sport}`
  bySource.set(k, (bySource.get(k) ?? 0) + 1)
}

console.log(`  scanned:  ${rows.length} rows with a position`)
console.log(`  foldable: ${changes.length}`)
for (const [k, n] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(5)}  ${k}`)

const sample = new Map()
for (const c of changes) if (!sample.has(c.position)) sample.set(c.position, c.to)
console.log('  mapping sample:')
for (const [from, to] of [...sample].slice(0, 12)) console.log(`      ${from.padEnd(22)} -> ${to}`)

if (!APPLY) {
  console.log('\n  DRY RUN — nothing written. Re-run with --apply --endpoint=' + endpoint)
  await prisma.$disconnect()
  process.exit(0)
}

/*
 * 🛑 THIS BLOCK CORRUPTED 2,063 PRODUCTION ROWS ON 2026-09-06 AND THE SCAR STAYS.
 *
 * It grouped by a STRING KEY joining two values with a delimiter, then split that key back
 * apart to recover them. Two NUL bytes had crept into the literals; a pre-commit scan found
 * and STRIPPED them, which is what created the bug — the join lost its separator
 * ("QuarterbackQB") and `split('')` became split-into-characters:
 *
 *     const k = `${c.position}${c.to}`     // separator gone
 *     const [from, to] = k.split('')       // ["Q","u","a","r",...]
 *
 * So `to` was "u", and `to` is what the updateMany wrote. "Quarterback" became "u",
 * "Wide Receiver" became "i", and the run printed `written: 2063` while doing it.
 *
 * ⚠ THE FIX IS TO DELETE THE KEY, NOT TO PICK A SAFER DELIMITER. Grouping now happens on a
 * Map keyed by the target code itself and carries the source values in the entry, so there
 * is no string to parse and nothing for a stray byte to change the meaning of.
 */
const byTarget = new Map()
for (const c of changes) {
  if (!byTarget.has(c.to)) byTarget.set(c.to, { to: c.to, froms: new Set(), ids: [] })
  const entry = byTarget.get(c.to)
  entry.froms.add(c.position)
  entry.ids.push(c.id)
}

let written = 0
for (const g of byTarget.values()) {
  const r = await prisma.sportsPlayer.updateMany({ where: { id: { in: g.ids } }, data: { position: g.to } })
  written += r.count
  console.log(`      ${String(r.count).padStart(5)}  ${[...g.froms].join(', ')} -> ${g.to}`)
}
console.log(`\n  written: ${written}`)

/*
 * ⚠ VERIFY AGAINST THE INTENDED TARGETS, NOT AGAINST "no long forms left".
 *
 * The check that used to sit here counted remaining long-form rows and reported 0 — while
 * every one of those rows held a single letter. It passed BECAUSE the data had been
 * destroyed: the old values were indeed gone. A success condition satisfied by the failure
 * is worse than no check.
 *
 * This reads the affected rows back and asserts each holds the code the plan intended.
 */
const wantById = new Map()
for (const g of byTarget.values()) for (const id of g.ids) wantById.set(id, g.to)
const after = await prisma.sportsPlayer.findMany({
  where: { id: { in: [...wantById.keys()] } },
  select: { id: true, position: true },
})
const wrong = after.filter((r) => wantById.get(r.id) !== r.position)
console.log(`  verified: ${after.length - wrong.length}/${after.length} hold the intended code`)
if (wrong.length) {
  console.log('  MISMATCHED — do not trust this run:')
  for (const w of wrong.slice(0, 10)) {
    console.log(`      ${w.id}  now=${JSON.stringify(w.position)}  want=${JSON.stringify(wantById.get(w.id))}`)
  }
}

await prisma.$disconnect()
