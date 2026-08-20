/**
 * Phase D.2 — READ-ONLY Canonical World CONFORMANCE check against a REAL database.
 *
 * Resolves the canonical world for real leagues and asserts the SAME origin-blind contract the
 * hermetic D.2 matrix (__tests__/decision-os/canonical-world-validation.test.ts) proves against
 * fixtures: identical fact key shape, no provider leakage into league/roster facts, honest bounded
 * completeness, no fabricated FAAB/points-against/enrichment, and faithful provenance.
 *
 * STRICTLY READ-ONLY: `resolveCanonicalWorld` reads through the prisma find* port only — this script
 * never seeds, writes, upserts, or cleans up anything.
 *
 *   DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-world-conformance.ts [leagueId ...]
 *
 * Refuses production unless ALLOW_PROD_READONLY=1 is set for the run (it performs no writes, so
 * inspecting real prod data is allowed, but only deliberately).
 *
 * With explicit league ids it validates exactly those (e.g. theciege24's imported Sleeper league).
 * With none, it auto-discovers a few real leagues (recently-synced imported provider leagues + a
 * couple of native AF leagues). Skips cleanly (exit 0) when no DATABASE_URL is configured, so it is
 * safe to wire into CI without a database.
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import type { CanonicalWorld } from '../lib/decision-os/world/facts'
import { assertNonProductionDbTarget, describeDbTarget } from './_db-target-identity'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}


;(async () => {
  // Gate BEFORE importing anything that pulls the prisma singleton (which throws without a DB URL).
  if (!hasDatabaseUrl()) {
    console.log('WORLD_CONFORMANCE SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run the real-data check.')
    process.exit(0)
  }

  // This script used to WARN and proceed on production. It could not actually do that — the host
  // literal it tested named the dev fork, so the warning never fired on the real production
  // database and prod runs happened silently. Now it refuses by default like the rest of the
  // family, with an explicit per-run opt-in: it performs no writes (find* only, asserted by its
  // test), so inspecting real production data stays possible, but only as a deliberate act.
  //
  //     ALLOW_PROD_READONLY=1 npx tsx scripts/decision-os-world-conformance.ts
  const dbTargetUrl = resolveDatabaseUrl()
  const host = describeDbTarget(dbTargetUrl)
  console.log(`Phase D.2 world conformance — READ-ONLY (find* only) — DB target: ${host}`)
  assertNonProductionDbTarget({
    script: 'decision-os-world-conformance',
    url: dbTargetUrl,
    action: 'reads canonical world facts',
    exitCode: 0,
    readOnlyProdOptIn: true,
  })

  // Dynamic imports AFTER the DB gate so the skip path never evaluates the prisma singleton.
  const { prisma } = await import('../lib/prisma')
  const { resolveCanonicalWorld } = await import('../lib/decision-os/world')

  // League ids: explicit argv wins; otherwise auto-discover a small, representative set read-only.
  const argvIds = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  let leagueIds = argvIds
  if (leagueIds.length === 0) {
    // `League.platform` is a NON-nullable column (native AF leagues use 'manual', imports carry the
    // provider name), so imported/native cannot be split by null. Validate the most-recently-synced
    // leagues regardless of platform; each one self-labels via `provenance.provider` in the report below.
    const recent = await prisma.league.findMany({
      select: { id: true },
      take: 5,
      orderBy: { lastSyncedAt: 'desc' },
    })
    leagueIds = recent.map((l: { id: string }) => l.id)
  }

  if (leagueIds.length === 0) {
    console.log('WORLD_CONFORMANCE SKIPPED (no leagues found in this database).')
    await prisma.$disconnect().catch(() => undefined)
    process.exit(0)
  }

  console.log(`Validating ${leagueIds.length} league(s): ${leagueIds.join(', ')}`)

  // The origin-blind structure must be IDENTICAL across every resolved world, imported or native.
  let refShape: { league: string; team: string; roster: string } | null = null

  for (const leagueId of leagueIds) {
    let world: CanonicalWorld | null = null
    try {
      world = await resolveCanonicalWorld(leagueId)
    } catch (e) {
      check(`[${leagueId}] resolveCanonicalWorld did not throw`, false, e instanceof Error ? e.message : String(e))
      continue
    }
    if (!world) {
      check(`[${leagueId}] resolved a world (league row exists)`, false, 'null world (no League row)')
      continue
    }

    const provider = world.provenance.provider
    const label = `[${leagueId}${provider ? ` ${provider}` : ' native'}]`

    // (1) Structural origin-blindness — same fact key shape for every world.
    const shape = {
      league: JSON.stringify(Object.keys(world.league).sort()),
      team: world.teams[0] ? JSON.stringify(Object.keys(world.teams[0]).sort()) : '',
      roster: world.rosters[0] ? JSON.stringify(Object.keys(world.rosters[0]).sort()) : '',
    }
    if (!refShape) {
      refShape = shape
    } else {
      check(`${label} league fact keys match the origin-blind shape`, shape.league === refShape.league)
      if (shape.team && refShape.team) check(`${label} team fact keys match`, shape.team === refShape.team)
      if (shape.roster && refShape.roster) check(`${label} roster fact keys match`, shape.roster === refShape.roster)
    }

    // (2) No origin leakage — the provider name lives ONLY in provenance, not in league/roster facts.
    if (provider) {
      const noLeak =
        !JSON.stringify(world.league).includes(provider) && !JSON.stringify(world.rosters).includes(provider)
      check(`${label} provider name does not leak into league/roster facts`, noLeak)
    }

    // (3) Honest, bounded completeness.
    const c = world.completeness
    check(`${label} completeness bounded 0..100`, c.dataCompleteness >= 0 && c.dataCompleteness <= 100, `score=${c.dataCompleteness}`)

    // (4) No fabrication — derived facts are provably real or honestly null.
    const fabricatedFaab = world.teams.some((t) => t.faab.remainingDerived && (t.faab.budget == null || t.faab.used == null))
    check(`${label} no fabricated FAAB (derived ⇒ budget + used present)`, !fabricatedFaab)
    const fabricatedPa = world.teams.some((t) => t.pointsAgainst !== null && t.pointsAgainstBasis === 'unavailable')
    check(`${label} no fabricated points-against (value ⇒ real basis)`, !fabricatedPa)
    const fakeEnrich = world.rosters.some((r) => r.playerMetadataEnriched)
    check(`${label} substrate claims no enrichment it did not perform`, !fakeEnrich)

    console.log(
      `   ↳ ${label} teams=${world.teams.length} rosters=${world.rosters.length} ` +
        `completeness=${c.dataCompleteness} warnings=${c.warnings.length} provider=${provider ?? 'native'}`,
    )
  }

  await prisma.$disconnect().catch(() => undefined)
  console.log(failures === 0 ? 'WORLD_CONFORMANCE_OK' : `WORLD_CONFORMANCE_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
