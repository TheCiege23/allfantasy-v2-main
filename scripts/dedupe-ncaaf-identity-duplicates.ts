/**
 * Runner for the NCAAF identity duplicate collapse. Dry by default; deletes only with `--apply`.
 *
 * 🛑 THIS DELETES ROWS FROM `PlayerIdentityMap`, AND A DELETE IS NOT REVERSIBLE. It removes only
 * the younger copies of rows that are identical in name, team and position to the oldest row
 * sharing their provider id. Anything that disagrees is reported and left alone.
 *
 *   npm run dedupe:ncaaf-identities              # dry, deletes nothing
 *   npm run dedupe:ncaaf-identities -- --apply
 *
 * ⚠ IT READS AND WRITES WHATEVER `DATABASE_URL` NAMES IN `.env`, which in this repo is
 * production. The host is printed before anything happens — read it.
 *
 * ⚠ BACKUP FIRST. The dry run prints every row it would delete to a JSON file; keep it. A deleted
 * identity row cannot be restored from the application, only re-created by the widening job.
 *
 * ⚠ `scripts/` is excluded from tsconfig, so a repo typecheck says nothing about this file.
 */

import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const outArg = args.find((a) => a.startsWith('--out='))
/* Same shape as the other snapshot files in scripts/, which .gitignore already excludes. */
const out = outArg
  ? outArg.split('=')[1]
  : `scripts/.ncaaf-identity-dupes-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`

function hostOf(url: string | undefined): string {
  const u = String(url ?? '')
  return u.includes('@') ? (u.split('@')[1]?.split('/')[0] ?? '(unparsed)') : '(unset)'
}

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const { dedupeNcaafIdentityDuplicates } = await import('@/lib/devy/ingestNcaafIdentitiesFromSportsPlayer')

  console.log(apply ? 'APPLY — this will DELETE rows.' : 'DRY RUN — nothing will be deleted.')
  console.log(`  database host        ${hostOf(process.env.DATABASE_URL)}`)

  const before = await prisma.playerIdentityMap.count({ where: { sport: 'NCAAF' } })
  console.log(`  NCAAF rows before    ${before.toLocaleString()}`)

  /*
   * The full text of every row that would go, written BEFORE any delete, so the backup exists
   * even if the apply is interrupted. A dry run and an apply produce the same file.
   */
  const doomed = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT p.* FROM "PlayerIdentityMap" p
    JOIN (
      SELECT "rollingInsightsId", MIN("createdAt") AS keep_from
      FROM "PlayerIdentityMap"
      WHERE sport = 'NCAAF' AND "rollingInsightsId" IS NOT NULL
      GROUP BY "rollingInsightsId" HAVING COUNT(*) > 1
    ) d ON d."rollingInsightsId" = p."rollingInsightsId" AND p."createdAt" > d.keep_from
    WHERE p.sport = 'NCAAF'
  `
  writeFileSync(out, JSON.stringify(doomed, null, 2))
  console.log(`  backup of ${doomed.length} candidate row(s) -> ${out}`)

  const result = await dedupeNcaafIdentityDuplicates({ dryRun: !apply })

  console.log('\nRESULT')
  for (const [k, v] of Object.entries(result)) {
    if (k === 'divergent') continue
    console.log(`  ${k.padEnd(18)} ${String(v)}`)
  }
  for (const group of result.divergent) {
    console.log(`\n  DIVERGENT ${group.providerId} — left alone, needs a human:`)
    for (const row of group.rows) console.log(`    ${row.id}  ${row.name}  ${row.team ?? '-'}  ${row.position ?? '-'}`)
  }

  const after = await prisma.playerIdentityMap.count({ where: { sport: 'NCAAF' } })
  console.log(`\n  NCAAF rows after     ${after.toLocaleString()}   (delta ${after - before})`)

  const expected = apply ? -result.deleted : 0
  if (after - before !== expected) {
    console.error(`\n  READ-BACK MISMATCH: expected delta ${expected}, measured ${after - before}`)
    process.exitCode = 1
  }
  if (result.error) process.exitCode = 1

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
