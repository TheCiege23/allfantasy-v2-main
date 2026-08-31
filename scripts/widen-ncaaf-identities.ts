/**
 * Runner for the NCAAF identity widening. Dry by default; writes only with
 * `--apply`.
 *
 * 🛑 THIS INSERTS INTO `PlayerIdentityMap`, WHICH IS THE CANONICAL TABLE THE
 * WHOLE APP RESOLVES PLAYERS AGAINST. A full run adds ~42,546 NCAAF rows. That
 * is not something to trigger by forgetting a flag, so `--apply` is required,
 * and the module it calls also defaults to a dry run independently.
 *
 *   npm run widen:ncaaf-identities                       # dry, writes nothing
 *   npm run widen:ncaaf-identities -- --apply --limit=200
 *   npm run widen:ncaaf-identities -- --apply            # the rest
 *
 * ⚠ RUN THE LIMITED BATCH FIRST. It prints a verification of rows that were
 * actually written — specifically whether they read BACK through the resolver,
 * which is the one failure that would otherwise be invisible: rows that exist,
 * count as success, and are unreachable by the lookup they were inserted for.
 *
 * ⚠ IT READS AND WRITES WHATEVER `DATABASE_URL` NAMES IN `.env`, which in this
 * repo is production. The host is printed before anything happens — read it.
 *
 * ⚠ UNDO. Every inserted row is `sport = 'NCAAF'` with a `createdAt` after the
 * timestamp this script prints before it writes. Keep that timestamp; it is the
 * only thing that separates these rows from the 20,027 that were already there.
 *
 * ⚠ `scripts/` is excluded from tsconfig, so a repo typecheck says nothing about
 * this file.
 */

import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

/*
 * The ingestion module is marked `server-only`, which throws outside Next. That
 * is stubbed by `scripts/_audit-preload.cjs`, loaded with `node --require` from
 * the npm script above — the shim this repo already uses for exactly this,
 * rather than a second one invented here.
 */

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const limitArg = args.find((a) => a.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined

function hostOf(url: string | undefined): string {
  const u = String(url ?? '')
  return u.includes('@') ? (u.split('@')[1]?.split('/')[0] ?? '(unparsed)') : '(unset)'
}

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const { widenNcaafIdentities } = await import('@/lib/devy/ingestNcaafIdentitiesFromSportsPlayer')
  const { resolveCanonicalPlayerId } = await import('@/lib/league-import/playerIdResolver')

  console.log(apply ? 'APPLY — this will write.' : 'DRY RUN — nothing will be written.')
  console.log(`  database host        ${hostOf(process.env.DATABASE_URL)}`)
  if (limit != null) console.log(`  limit                ${limit}`)

  const before = await prisma.playerIdentityMap.count({ where: { sport: 'NCAAF' } })
  const cutoff = new Date()
  console.log(`  NCAAF rows before    ${before.toLocaleString()}`)
  if (apply) {
    console.log(`\n  UNDO PREDICATE — keep this:`)
    console.log(`    sport = 'NCAAF' AND "createdAt" > '${cutoff.toISOString()}'`)
  }

  const t0 = Date.now()
  const result = await widenNcaafIdentities({ dryRun: !apply, limit })
  const secs = Math.round((Date.now() - t0) / 1000)

  console.log('\nRESULT')
  for (const [k, v] of Object.entries(result)) console.log(`  ${k.padEnd(12)} ${String(v)}`)
  console.log(`  ${'elapsed'.padEnd(12)} ${secs}s`)

  const after = await prisma.playerIdentityMap.count({ where: { sport: 'NCAAF' } })
  console.log(`\n  NCAAF rows after     ${after.toLocaleString()}   (delta ${after - before})`)
  if (!apply && after !== before) console.log('  🛑 A DRY RUN CHANGED THE ROW COUNT — investigate before doing anything else.')
  if (!apply) {
    console.log('  proof nothing was written: row count unchanged')
    await prisma.$disconnect()
    return
  }

  /*
   * 🛑 THE VERIFICATION THAT MATTERS. A row written under a key the resolver
   * never computes is invisible: it exists, it counted as an insert, and no
   * lookup will ever find it. Two implementations of the normalizer already
   * disagreed once during this work, so this is checked against rows that were
   * really written rather than assumed from the design.
   */
  const written = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NCAAF', createdAt: { gt: cutoff } },
    select: { id: true, canonicalName: true, normalizedName: true, currentTeam: true, position: true },
    take: 25,
  })
  console.log(`\nREAD-BACK CHECK on ${written.length} of the rows just written:`)
  let reachable = 0
  let ambiguous = 0
  for (const row of written) {
    const out = await resolveCanonicalPlayerId({
      provider: 'sleeper',
      sourceId: '__no_such_id__',
      nameHint: row.canonicalName,
    })
    if (out.canonicalId === row.id) reachable += 1
    else if (out.confidence === 'ambiguous') ambiguous += 1
  }
  console.log(`  resolve to the exact row written   ${reachable}/${written.length}`)
  console.log(`  ambiguous (name shared, expected)  ${ambiguous}/${written.length}`)
  const unreachable = written.length - reachable - ambiguous
  console.log(`  UNREACHABLE                        ${unreachable}/${written.length}`)
  if (unreachable > 0) {
    console.log('  🛑 STOP. Rows were written that no lookup can reach. Do not run the')
    console.log('     remainder. Undo with the predicate above and re-check the normalizer.')
  } else {
    console.log('  ✓ every written row is reachable or legitimately ambiguous')
  }

  console.log('\n  sample of what was written:')
  written.slice(0, 8).forEach((r) =>
    console.log(`    ${r.canonicalName.padEnd(26)} ${String(r.currentTeam).padEnd(28)} ${r.position ?? '—'}`),
  )

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
