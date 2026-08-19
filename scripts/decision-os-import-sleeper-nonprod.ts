/**
 * ADR-DOS-F0 — Controlled NON-PROD Sleeper import runner (validation seeder).
 *
 * Makes ONE real imported Sleeper league for a provider account available in a NON-PROD database so the
 * existing read-only Decision OS validation scripts (decision-os-world/trade-conformance.ts) can target
 * an imported-provider league. It re-runs the EXACT import pipeline the product uses — sourcing from the
 * PUBLIC Sleeper API, never from prod — minus the route's HTTP/auth shell:
 *
 *     runImportedLeagueNormalizationPipeline → buildCanonicalImportBundle → persistImportWithCanonicalAudit
 *
 * Boundary (see lib/decision-os/ADR_F0_NONPROD_IMPORTED_LEAGUE.md):
 *   • WRITES only the non-prod SOURCE-of-truth import tables (League/LeagueTeam/Roster + import audit
 *     trail + one importer AppUser) via the existing, audited import services — the same rows the
 *     product writes on every real import.
 *   • NEVER writes Canonical World (lib/decision-os/world is a derived, storage-less, find*-only layer —
 *     this runner imports no world write surface because none exists; it only READS via resolveCanonicalWorld).
 *   • HARD-REFUSES the production DB host (ep-spring-tooth) and SKIPs cleanly without DATABASE_URL.
 *   • Idempotent: re-runs short-circuit a completed ImportRun; `--force` re-imports over an existing league.
 *
 *     DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-import-sleeper-nonprod.ts [options]
 *
 * Options:
 *   --account=<username>   Sleeper username to import for (default: theciege24).
 *   --league=<sourceId>    Import this exact Sleeper league id (skips discovery; recommended — lets the
 *                          operator control import weight). If omitted, discovery picks the first
 *                          redraft league found for the account+season+sport.
 *   --season=<year>        Season to discover (default: previous completed season, 2024).
 *   --sport=<nfl|...>      Sport to discover (default: nfl).
 *   --force                Re-import over an existing league (allowUpdateExisting).
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'

const PROD_HOST_MARKER = 'ep-spring-tooth'

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`)

function hostOf(url: string | null): string {
  if (!url) return '?'
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return '?'
  }
}

;(async () => {
  // Gate BEFORE importing anything that pulls the prisma singleton.
  if (!hasDatabaseUrl()) {
    console.log('NONPROD_IMPORT SKIPPED (no DATABASE_URL) — set a NON-PROD DATABASE_URL to seed an imported league.')
    process.exit(0)
  }
  const host = hostOf(resolveDatabaseUrl())
  if (host.includes(PROD_HOST_MARKER)) {
    console.error(`REFUSED: resolved DB host (${host}) is the PRODUCTION host (${PROD_HOST_MARKER}). This runner writes import rows and must NEVER touch production.`)
    process.exit(1)
  }

  const account = (arg('account') ?? 'theciege24').trim()
  const explicitLeague = arg('league')?.trim()
  const season = (arg('season') ?? '2024').trim()
  const sport = (arg('sport') ?? 'nfl').trim().toLowerCase()
  const force = hasFlag('force')

  console.log(`ADR-DOS-F0 non-prod Sleeper import — DB host: ${host}`)
  console.log(`account=${account} season=${season} sport=${sport}${explicitLeague ? ` league=${explicitLeague}` : ' (discover)'} force=${force}`)

  // Dynamic imports AFTER the DB + host gate so the skip/refuse paths never evaluate the prisma singleton.
  const { prisma } = await import('../lib/prisma')
  const { resolveProvider } = await import('../lib/league-import/ImportProviderResolver')
  const { runImportedLeagueNormalizationPipeline } = await import('../lib/league-import/ImportedLeagueNormalizationPipeline')
  const { buildCanonicalImportBundle } = await import('../lib/league-import/canonicalImportNormalizer')
  const { persistImportWithCanonicalAudit } = await import('../lib/league-import/importPersistenceService')
  const { resolveCanonicalWorld } = await import('../lib/decision-os/world')

  const provider = resolveProvider('sleeper')
  if (!provider) {
    console.error('REFUSED: sleeper provider did not resolve.')
    process.exit(1)
  }

  try {
    // 1) Resolve the source league id (explicit wins; else discover via the PUBLIC Sleeper API).
    let sourceId = explicitLeague
    if (!sourceId) {
      // Lazy-load the discovery helpers ONLY when needed — `lib/sleeper/user-lookup` pulls in
      // `server-only`, which would otherwise abort this CLI even when an explicit --league is given.
      const { lookupSleeperUser } = await import('../lib/sleeper/user-lookup')
      const { getUserLeagues } = await import('../lib/sleeper-client')
      const lookup = await lookupSleeperUser(account)
      if (lookup.status !== 'found') {
        console.error(`REFUSED: Sleeper account "${account}" lookup ${lookup.status}.`)
        process.exit(1)
      }
      const leagues = await getUserLeagues(lookup.user.user_id, sport, season)
      if (leagues.length === 0) {
        console.error(`REFUSED: no ${sport} ${season} leagues for "${account}".`)
        process.exit(1)
      }
      // Prefer a redraft league (settings.type 0) for the first seed — lighter than dynasty (no
      // multi-season backfill) — but fall back to whatever exists.
      const redraft = leagues.find((l) => l.settings?.type === 0)
      const picked = redraft ?? leagues[0]
      sourceId = picked.league_id
      console.log(`Discovered ${leagues.length} league(s); seeding "${picked.name}" (${sourceId}, ${picked.total_rosters}-team, type=${picked.settings?.type}).`)
    }

    // 2) Ensure a dedicated, clearly-named NON-PROD importer AppUser to own the ImportRun audit row.
    const importerEmail = 'decision-os-nonprod-importer@allfantasy.local'
    const importerUsername = 'decision_os_nonprod_importer'
    const importer = await prisma.appUser.upsert({
      where: { email: importerEmail },
      update: {},
      create: {
        email: importerEmail,
        username: importerUsername,
        displayName: 'Decision OS Non-Prod Importer',
      },
      select: { id: true },
    })
    console.log(`Importer AppUser: ${importer.id} (${importerUsername})`)

    // 3) Run the REAL pipeline verbatim (public fetch → normalize → canonical bundle → persist).
    const normResult = await runImportedLeagueNormalizationPipeline({ provider, sourceId, userId: importer.id })
    if (!normResult.success) {
      console.error(`REFUSED: normalization failed [${normResult.code}] ${normResult.error}`)
      process.exit(1)
    }
    const canonical = buildCanonicalImportBundle(normResult.normalized)
    const { persisted, runId } = await persistImportWithCanonicalAudit({
      userId: importer.id,
      provider,
      normalized: normResult.normalized,
      canonical,
      allowUpdateExisting: force,
    })
    const leagueId = persisted.league.id
    console.log(`Persisted league "${persisted.league.name}" (${leagueId}) sport=${persisted.league.sport} existed=${persisted.existed ?? false} runId=${runId}`)

    // 4) Prove discoverability READ-ONLY through the existing canonical port (find* only).
    const world = await resolveCanonicalWorld(leagueId)
    if (!world) {
      console.error('NONPROD_IMPORT_FAILED — resolveCanonicalWorld returned null for the seeded league.')
      process.exit(1)
    }
    const prov = world.provenance.provider
    const rostersWithPlayers = world.rosters.filter((r) => r.playerCount > 0).length
    console.log(
      `Canonical world (read-only): provider=${prov ?? 'native'} teams=${world.teams.length} ` +
        `rosters=${world.rosters.length} rostersWithPlayers=${rostersWithPlayers} ` +
        `completeness=${world.completeness.dataCompleteness} warnings=${world.completeness.warnings.length}`,
    )

    const ok = prov !== null && world.teams.length > 0 && world.rosters.length > 0
    console.log(`IMPORTED_LEAGUE_ID=${leagueId}`)
    await prisma.$disconnect().catch(() => undefined)
    if (!ok) {
      console.error('NONPROD_IMPORT_FAILED — seeded league did not resolve as an imported world with teams + rosters.')
      process.exit(1)
    }
    console.log('NONPROD_IMPORT_OK — imported Sleeper league is available + resolvable read-only in non-prod.')
    console.log(`Next: DATABASE_URL=<this db> npx tsx scripts/decision-os-world-conformance.ts ${leagueId}`)
    process.exit(0)
  } catch (e) {
    await prisma.$disconnect().catch(() => undefined)
    console.error('NONPROD_IMPORT_FAILED (exception)', e instanceof Error ? e.stack : e)
    process.exit(1)
  }
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
