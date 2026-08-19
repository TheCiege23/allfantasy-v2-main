/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort — internal CLI (Step 12).
 *
 * The ONLY place that makes live Sleeper calls. This is an explicit INTERNAL validation workflow — it is
 * never reachable from a customer request path. It resolves a cohort of Sleeper usernames, imports league
 * data DB-lessly, classifies archetypes, runs the reachable Decision OS derivations, and writes a
 * timestamped machine-readable report + a concise human summary.
 *
 * Usage:
 *   npx tsx scripts/decision-os-validate-sleeper-cohort.ts --username=<one>            # single account
 *   npx tsx scripts/decision-os-validate-sleeper-cohort.ts --cohort=<file>            # newline-delimited list
 *   npx tsx scripts/decision-os-validate-sleeper-cohort.ts --cohort=<file> --dryRun   # resolve + discover only
 *   [--season=YYYY] [--sport=nfl] [--concurrency=3] [--maxTxWeeks=18] [--out=<dir>]
 *   [--resume=<prior report.json>]   # skip leagues already in a prior report
 *
 * Boundaries: DB-less (no DATABASE_URL, no writes to any product table); provider-agnostic downstream of
 * the resolver; no fabricated data; bounded concurrency; safe to re-run.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { normalizeCohort } from '../lib/validation-cohort/normalizeCohort'
import { runCohort } from '../lib/validation-cohort/runCohort'
import { runDiscovery } from '../lib/validation-cohort/portfolioDiscovery'
import { persistPortfolio } from '../lib/validation-cohort/persistence/persistPortfolio'
import { FileEvidenceStore } from '../lib/validation-cohort/persistence/fileEvidenceStore'
import { checkEvidenceIntegrity, summarizeIntegrityBySeverity } from '../lib/validation-cohort/persistence/integrityChecker'
import { buildLeagueReadModel, buildPlatformReadModel } from '../lib/validation-cohort/evidence/decisionOsReadModel'
import { runCorpusValidation, type CorpusDataSource } from '../lib/validation-cohort/validation/corpusRunner'
import { CorpusEvidencePort, runCompositionValidation } from '../lib/validation-cohort/validation/compositionBridge'
import { makeDefaultFetch } from '../lib/validation-cohort/sleeperCohortClient'
import { renderHumanSummary } from '../lib/validation-cohort/reportBuilder'
import type { CohortAggregateReport } from '../lib/validation-cohort/types'

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`)

function readCohortLines(): string[] {
  const single = arg('username')
  if (single) return [single]
  const file = arg('cohort')
  if (!file) return []
  const abs = path.resolve(file)
  if (!fs.existsSync(abs)) {
    console.error(`cohort file not found: ${abs}`)
    process.exit(1)
  }
  return fs.readFileSync(abs, 'utf8').split(/\r?\n/)
}

function loadResumeSet(): Set<string> {
  const file = arg('resume')
  if (!file) return new Set()
  try {
    const prior = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as CohortAggregateReport
    return new Set(prior.perLeague.map((l) => l.leagueReference))
  } catch {
    console.warn(`could not read --resume report; proceeding without resume set`)
    return new Set()
  }
}

;(async () => {
  const lines = readCohortLines()
  // --validate is REPORT-ONLY over an already-persisted corpus — it needs no cohort input.
  if (lines.length === 0 && !hasFlag('validate')) {
    console.error('no cohort input — pass --username=<name> or --cohort=<file>')
    process.exit(1)
  }

  const accounts = normalizeCohort(lines)
  const dryRun = hasFlag('dryRun')
  const season = arg('season')
  const sport = arg('sport') ?? 'nfl'
  const concurrency = Number(arg('concurrency') ?? '3')
  const maxTxWeeks = Number(arg('maxTxWeeks') ?? '18')
  // Default output goes to the OS temp dir — reports may contain league data and must never land in the
  // repo by default. Pass --out=<dir> to write elsewhere (e.g. a gitignored analysis folder).
  const outDir = path.resolve(arg('out') ?? path.join(os.tmpdir(), 'decision-os-validation-cohort'))
  const fetchJson = makeDefaultFetch(Number(arg('timeoutMs') ?? '8000'), Number(arg('retries') ?? '2'))

  console.log(
    `[validate-cohort] candidates=${accounts.length} resolvable=${accounts.filter((a) => a.status === 'pending').length} ambiguous=${accounts.filter((a) => a.status === 'ambiguous').length} dryRun=${dryRun}`,
  )

  fs.mkdirSync(outDir, { recursive: true })
  const stamp0 = new Date().toISOString().replace(/[:.]/g, '-')

  // ── Discover mode (Phase V7.2): multi-season historical portfolio manifest + coverage matrix. ──
  if (hasFlag('discover')) {
    const seasons = (arg('seasons') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (seasons.length === 0) {
      console.error('--discover requires an explicit bounded --seasons list, e.g. --seasons=2024,2023,2022')
      process.exit(1)
    }
    const { accounts: acc, manifest, coverage } = await runDiscovery(accounts, fetchJson, {
      seasons,
      sport,
      concurrency,
      resolveRoles: !hasFlag('noRoles'),
    })
    const mPath = path.join(outDir, `portfolio-manifest-${stamp0}.json`)
    const cPath = path.join(outDir, `historical-coverage-matrix-${stamp0}.json`)
    fs.writeFileSync(mPath, JSON.stringify({ accounts: acc, manifest }, null, 2))
    fs.writeFileSync(cPath, JSON.stringify(coverage, null, 2))
    console.log(
      `[discover] resolved=${manifest.totals.resolved}/${manifest.totals.accounts} uniqueLeagues=${manifest.totals.uniqueLeagues} seasons=[${manifest.totals.seasons.join(',')}] chains=${manifest.totals.chains} sharedLeagues=${manifest.sharedLeagues.length}`,
    )
    console.log(`[discover] wrote ${mPath}`)
    console.log(`[discover] wrote ${cPath}`)
    console.log('DISCOVER_OK')
    return
  }

  // ── Validate mode (Phase V8.3): REPORT-ONLY Decision OS validation over an already-persisted corpus.
  //    Never fetches provider data. ──
  if (hasFlag('validate')) {
    const storeRoot = path.resolve(arg('store') ?? path.join(os.tmpdir(), 'decision-os-evidence-store'))
    const store = new FileEvidenceStore(storeRoot)
    const corpusLeagues = await store.listLeagues()
    if (corpusLeagues.length === 0) {
      console.error(`no persisted corpus at ${storeRoot} — run --persist first`)
      process.exit(1)
    }
    // Label by data source honestly — a single public account is NOT a diverse cohort.
    const dataSource: CorpusDataSource = (arg('dataSource') as CorpusDataSource) ?? 'single-account-smoke'
    const report = runCorpusValidation(corpusLeagues, dataSource)
    // V8.4: execute the REAL production composition functions reachable via the evidence bridge.
    const composition = runCompositionValidation(new CorpusEvidencePort(corpusLeagues))
    fs.mkdirSync(storeRoot, { recursive: true })
    fs.writeFileSync(path.join(storeRoot, `decision-os-validation-${stamp0}.json`), JSON.stringify(report, null, 2))
    fs.writeFileSync(path.join(storeRoot, `composition-execution-matrix-${stamp0}.json`), JSON.stringify(composition, null, 2))
    console.log(
      `[validate] dataSource=${report.dataSource} leaguesEvaluated=${report.leaguesEvaluated} recommendations=${report.diversity.total} perLeague=${report.diversity.perLeague.toFixed(2)}`,
    )
    console.log(`[validate] typeDistribution=${JSON.stringify(report.diversity.typeDistribution)}`)
    console.log(`[validate] overFiring=${report.overFiring.length} underFiringCandidates=${report.underFiring.length}`)
    console.log('[validate] composition execution matrix:')
    for (const c of composition) console.log(`  ${c.status.padEnd(28)} ${c.subsystem} (${c.entryPoint}) produced=${c.producedCount} owner=${c.owner}`)
    console.log('VALIDATE_CORPUS_OK')
    return
  }

  // ── Persist mode (Phase V8.1): discover + persist provider-neutral evidence to the store. ──
  if (hasFlag('persist')) {
    const seasons = (arg('seasons') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (seasons.length === 0) {
      console.error('--persist requires an explicit bounded --seasons list, e.g. --seasons=2024,2023,2022')
      process.exit(1)
    }
    const currentSeason = arg('currentSeason') ?? [...seasons].sort().at(-1)!
    const storeRoot = path.resolve(arg('store') ?? path.join(os.tmpdir(), 'decision-os-evidence-store'))
    const store = new FileEvidenceStore(storeRoot)
    const result = await persistPortfolio(accounts, fetchJson, store, {
      seasons,
      currentSeason,
      sport,
      concurrency,
      maxLeaguesPerAccount: arg('maxLeaguesPerAccount') ? Number(arg('maxLeaguesPerAccount')) : undefined,
      maxTxWeeks,
      importEvidence: hasFlag('importEvidence'),
      evidenceWeeks: arg('evidenceWeeks') ? Number(arg('evidenceWeeks')) : undefined,
    })
    const leagues = await store.listLeagues()
    const integrity = checkEvidenceIntegrity(leagues, await store.listPortfolios())
    const severity = summarizeIntegrityBySeverity(integrity)
    const state = await store.readImportState()

    // Decision OS read-compatibility across the seven Operating Systems (Part 7).
    const perOs: Record<string, boolean> = {}
    for (const l of leagues) for (const c of buildLeagueReadModel(l)) perOs[c.os] = (perOs[c.os] ?? true) && c.available
    perOs['platform'] = buildPlatformReadModel(leagues).available

    fs.writeFileSync(path.join(storeRoot, `integrity-${stamp0}.json`), JSON.stringify(integrity, null, 2))
    fs.writeFileSync(path.join(storeRoot, `decision-os-compat-${stamp0}.json`), JSON.stringify(perOs, null, 2))
    console.log(
      `[persist] imported=${result.imported} skippedImmutable=${result.skippedImmutable} partialFailures=${result.partialFailures} durationMs=${state.lastSyncDurationMs}`,
    )
    console.log(`[persist] store=${storeRoot} importedSeasons=[${state.importedSeasons.join(',')}] integrityFindings=${integrity.length} severity=${JSON.stringify(severity)}`)
    console.log(`[persist] decisionOsCompat=${JSON.stringify(perOs)}`)
    console.log('PERSIST_OK')
    return
  }

  const { report } = await runCohort(accounts, fetchJson, {
    season,
    sport,
    concurrency,
    maxTxWeeks,
    dryRun,
    maxLeagues: arg('maxLeagues') ? Number(arg('maxLeagues')) : undefined,
    alreadyDone: loadResumeSet(),
  })

  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const tag = dryRun ? 'dryrun' : 'run'
  const jsonPath = path.join(outDir, `cohort-${tag}-${stamp}.json`)
  const txtPath = path.join(outDir, `cohort-${tag}-${stamp}.txt`)
  fs.writeFileSync(jsonPath, JSON.stringify({ accounts, report }, null, 2))
  fs.writeFileSync(txtPath, renderHumanSummary(report))

  console.log(renderHumanSummary(report))
  console.log(`\n[validate-cohort] wrote ${jsonPath}`)
  console.log(`[validate-cohort] wrote ${txtPath}`)
  console.log(dryRun ? 'VALIDATE_COHORT_DRY_RUN_OK' : 'VALIDATE_COHORT_OK')
})().catch((err) => {
  console.error('[validate-cohort] fatal:', err)
  process.exit(1)
})
