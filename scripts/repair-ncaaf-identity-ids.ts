/**
 * Runner for the NCAAF identity provider-id repair. Dry by default; writes only with `--apply`.
 *
 * Fills `rollingInsightsId` / `cfbdId` into NCAAF PlayerIdentityMap rows that carry NO provider id
 * at all — the 38,904 rows `widen:ncaaf-identities` wrote on 2026-08-31 without the id that was
 * sitting in the same SportsPlayer row as the name. See `repairNcaafIdentityProviderIds` for the
 * guards; every one of them reports its own count below.
 *
 *   npm run repair:ncaaf-identity-ids              # dry, writes nothing
 *   npm run repair:ncaaf-identity-ids -- --apply
 *
 * ⚠ IT READS AND WRITES WHATEVER `DATABASE_URL` NAMES IN `.env`, which in this repo is
 * production. The host is printed before anything happens — read it.
 *
 * ⚠ UNDO. Only rows that had no provider id are touched, so this restores them exactly:
 *   UPDATE "PlayerIdentityMap" SET "rollingInsightsId" = NULL, "cfbdId" = NULL
 *   WHERE sport = 'NCAAF' AND "updatedAt" >= '<the cutoff printed below>'
 *     AND "sleeperId" IS NULL AND "fantasyCalcId" IS NULL AND "apiSportsId" IS NULL
 *     AND "mflId" IS NULL AND "espnId" IS NULL AND "fleaflickerId" IS NULL
 *     AND "clearSportsId" IS NULL AND "fantraxId" IS NULL
 *     AND "createdAt" >= '2026-08-31' AND "createdAt" < '2026-09-01'
 *
 * ⚠ `scripts/` is excluded from tsconfig, so a repo typecheck says nothing about this file.
 */

const args = process.argv.slice(2)
const apply = args.includes('--apply')

function hostOf(url: string | undefined): string {
  const u = String(url ?? '')
  return u.includes('@') ? (u.split('@')[1]?.split('/')[0] ?? '(unparsed)') : '(unset)'
}

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const { repairNcaafIdentityProviderIds } = await import('@/lib/devy/ingestNcaafIdentitiesFromSportsPlayer')

  console.log(apply ? 'APPLY — this will write.' : 'DRY RUN — nothing will be written.')
  console.log(`  database host        ${hostOf(process.env.DATABASE_URL)}`)

  const idWhere = { sport: 'NCAAF', rollingInsightsId: { not: null } } as const
  const before = await prisma.playerIdentityMap.count({ where: idWhere })
  const cutoff = new Date()
  console.log(`  NCAAF rows with an RI id before   ${before.toLocaleString()}`)
  if (apply) console.log(`  UNDO CUTOFF — keep this: ${cutoff.toISOString()}`)

  const t0 = Date.now()
  const result = await repairNcaafIdentityProviderIds({ dryRun: !apply })
  const secs = Math.round((Date.now() - t0) / 1000)

  console.log('\nRESULT')
  for (const [k, v] of Object.entries(result)) {
    console.log(`  ${k.padEnd(16)} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  }
  console.log(`  ${'elapsed'.padEnd(16)} ${secs}s`)

  const after = await prisma.playerIdentityMap.count({ where: idWhere })
  console.log(`\n  NCAAF rows with an RI id after    ${after.toLocaleString()}   (delta ${after - before})`)

  // Read-back: an apply must move the count by exactly what it reported writing. A dry run must not
  // move it at all. Either mismatch is a failure, not a warning.
  const expected = apply ? result.written.rollingInsightsId : 0
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
