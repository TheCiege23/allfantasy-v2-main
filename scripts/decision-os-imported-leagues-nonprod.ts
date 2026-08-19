/**
 * ADR-DOS-F0 — READ-ONLY discoverability proof for imported leagues in a NON-PROD database.
 *
 * The standing "is an imported-provider league discoverable + resolvable through the read-only Canonical
 * World port?" check. Lists every league whose canonical `provenance.provider` is non-null (i.e. imported
 * from a provider, not native AF) and resolves each via `resolveCanonicalWorld` (find* only). Prints a
 * per-league line and an `IMPORTED_LEAGUES_FOUND=<n>` sentinel so it can gate the next validation step.
 *
 * STRICTLY READ-ONLY: never seeds, writes, or mutates. Skips cleanly without DATABASE_URL; refuses prod.
 *
 *     DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-imported-leagues-nonprod.ts
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'

const PROD_HOST_MARKER = 'ep-spring-tooth'

function hostOf(url: string | null): string {
  if (!url) return '?'
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return '?'
  }
}

;(async () => {
  if (!hasDatabaseUrl()) {
    console.log('IMPORTED_LEAGUES SKIPPED (no DATABASE_URL).')
    process.exit(0)
  }
  const host = hostOf(resolveDatabaseUrl())
  if (host.includes(PROD_HOST_MARKER)) {
    console.error(`REFUSED: resolved DB host (${host}) is the PRODUCTION host. This is a non-prod discoverability check.`)
    process.exit(1)
  }
  console.log(`ADR-DOS-F0 imported-league discovery — READ-ONLY — DB host: ${host}`)

  const { prisma } = await import('../lib/prisma')
  const { resolveCanonicalWorld } = await import('../lib/decision-os/world')

  // Origin-blind discovery: don't hardcode provider platform strings into the filter — resolve EVERY
  // league's canonical provenance and keep the ones the substrate itself labels as imported.
  const leagues = await prisma.league.findMany({
    select: { id: true, name: true, platform: true },
    orderBy: { lastSyncedAt: 'desc' },
    take: 200,
  })

  const imported: Array<{ id: string; name: string | null; provider: string; teams: number; rosters: number; completeness: number }> = []
  for (const lg of leagues) {
    let world
    try {
      world = await resolveCanonicalWorld(lg.id)
    } catch {
      continue
    }
    if (!world) continue
    const provider = world.provenance.provider
    if (!provider) continue // native AF — not an imported league
    imported.push({
      id: lg.id,
      name: lg.name,
      provider,
      teams: world.teams.length,
      rosters: world.rosters.filter((r) => r.playerCount > 0).length,
      completeness: world.completeness.dataCompleteness,
    })
  }

  for (const i of imported) {
    console.log(`  • ${i.id} "${i.name ?? ''}" provider=${i.provider} teams=${i.teams} rostersWithPlayers=${i.rosters} completeness=${i.completeness}`)
  }
  console.log(`IMPORTED_LEAGUES_FOUND=${imported.length}`)

  await prisma.$disconnect().catch(() => undefined)
  process.exit(0)
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
