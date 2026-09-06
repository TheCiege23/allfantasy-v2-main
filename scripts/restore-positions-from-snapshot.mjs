#!/usr/bin/env node
/*
 * RESTORE SportsPlayer.position from the pre-backfill snapshot.
 *
 * Undoes the damage from backfill-provider-position-codes.mjs, which wrote single-character
 * positions ("u", "i", "f") to 2,063 rows because two NUL bytes were stripped out of its
 * string literals, turning a delimiter into an empty string and `split(delim)` into a
 * split-into-characters.
 *
 * Restores each row to the EXACT value captured before the write. No mapping, no cleverness
 * — the snapshot holds id + original position and this writes them straight back.
 *
 * Usage:
 *   node scripts/restore-positions-from-snapshot.mjs <snapshot.json>                  # dry run
 *   node scripts/restore-positions-from-snapshot.mjs <snapshot.json> --apply --endpoint=<id>
 */

import fs from 'node:fs'

const args = process.argv.slice(2)
const SNAP = args.find((a) => a.endsWith('.json'))
const APPLY = args.includes('--apply')
const WANT = (args.find((a) => a.startsWith('--endpoint=')) ?? '').split('=')[1] ?? ''

if (!SNAP || !fs.existsSync(SNAP)) {
  console.log('  need a snapshot path')
  process.exit(1)
}

function envFrom(file, key) {
  if (!fs.existsSync(file)) return null
  const l = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((x) => x.startsWith(key + '='))
  return l ? l.slice(key.length + 1).replace(/^["']|["']$/g, '') : null
}

const url = envFrom('.env.local', 'DATABASE_URL') || envFrom('.env', 'DATABASE_URL')
const endpoint = ((url.split('@')[1] || '').split('/')[0] || '').split('.')[0].replace(/-pooler$/, '')
const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'))

console.log('  endpoint now      : ' + endpoint)
console.log('  snapshot endpoint : ' + snap.endpoint)
console.log('  snapshot taken    : ' + snap.capturedAt)
console.log('  rows in snapshot  : ' + snap.rows.length)
console.log('  mode              : ' + (APPLY ? 'APPLY (writes)' : 'DRY RUN'))

if (snap.endpoint !== endpoint) {
  console.log('  REFUSING — snapshot was taken against a different database')
  process.exit(1)
}
if (APPLY && endpoint !== WANT) {
  console.log(`  REFUSING — --apply requires --endpoint=${endpoint}`)
  process.exit(1)
}

process.env.DATABASE_URL = url
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

/* Group by the ORIGINAL value so this is ~25 updateMany calls, not 2,063 writes. */
const byOriginal = new Map()
for (const r of snap.rows) {
  if (!byOriginal.has(r.position)) byOriginal.set(r.position, [])
  byOriginal.get(r.position).push(r.id)
}

console.log('\n  restore plan:')
for (const [pos, ids] of [...byOriginal].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`      ${String(ids.length).padStart(5)}  ->  ${JSON.stringify(pos)}`)
}

if (!APPLY) {
  console.log('\n  DRY RUN — nothing written. Re-run with --apply --endpoint=' + endpoint)
  await prisma.$disconnect()
  process.exit(0)
}

let restored = 0
for (const [pos, ids] of byOriginal) {
  const r = await prisma.sportsPlayer.updateMany({ where: { id: { in: ids } }, data: { position: pos } })
  restored += r.count
}
console.log(`\n  restored: ${restored}`)

/* Read it back rather than trusting the counts. */
const ids = snap.rows.map((r) => r.id)
const after = await prisma.sportsPlayer.findMany({ where: { id: { in: ids } }, select: { id: true, position: true } })
const want = new Map(snap.rows.map((r) => [r.id, r.position]))
const wrong = after.filter((r) => want.get(r.id) !== r.position)
console.log(`  verified: ${after.length - wrong.length}/${after.length} match the snapshot exactly`)
if (wrong.length) {
  console.log('  MISMATCHED:')
  for (const w of wrong.slice(0, 10)) console.log(`      ${w.id}  now=${JSON.stringify(w.position)}  want=${JSON.stringify(want.get(w.id))}`)
}

/* And confirm no single-character garbage survives anywhere. */
const junk = await prisma.sportsPlayer.count({ where: { position: { in: ['u', 'i', 'f', 'a', 'e', 'n', 'o', 'l'] } } })
console.log(`  single-letter positions remaining anywhere: ${junk}   (0 = clean)`)

await prisma.$disconnect()
