const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { patchManifestRace } = require('./patch-manifest-race.cjs')

const repoRoot = process.cwd()
const backupRoot = path.join(repoRoot, '.next-build-disabled-routes')
const MANIFEST_FILE = 'manifest.json'
const manifestPath = path.join(backupRoot, MANIFEST_FILE)
const isVercelBuild =
  process.env.VERCEL === '1' ||
  process.env.NOW_BUILDER ||
  process.env.VERCEL_URL
const isRailwayBuild =
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_PROJECT_ID ||
  process.env.RAILWAY_SERVICE_ID
let resolvedDistDir = process.env.AF_NEXT_DIST_DIR || (isVercelBuild || isRailwayBuild ? '.next' : '.next-build-fix')
let nextBuildDir = path.join(repoRoot, resolvedDistDir)
const routeDirsToDisable = [
  path.join('app', 'e2e'),
  path.join('app', 'tools', 'social-share-engine-harness'),
  path.join('app', 'tools', 'public-league-discovery-harness'),
  // Keep non-core diagnostic/dev surfaces out of production route budget.
  path.join('app', 'api', 'cron'),
  path.join('app', 'api', 'audio-metadata'),
  path.join('app', 'ai-lab'),
  path.join('app', 'lab'),
  path.join('app', 'bracket-review'),
  path.join('app', 'createor'),
  path.join('app', 'manifest.experimental.webmanifest'),
  // Dev/test/lab routes — never needed in production (reduce Vercel route budget).
  path.join('app', 'api', 'dev'),
  path.join('app', 'api', 'e2e'),
  path.join('app', 'api', 'lab'),
  path.join('app', 'api', 'simulation-lab'),
  // Pure redirect-alias pages — replaced by next.config.js redirects below.
  path.join('app', 'march-madness'),
  path.join('app', 'wallet', 'deposit'),
  // Game modes deferred until launch — keeps Vercel route budget under 2048.
  // Disable only the *route-bearing* subdirs; the `components/` subdirs stay
  // because external code (e.g. CommissionerSettingsModal, components/zombie/*)
  // imports shared zombie/survivor UI from them. Restore by removing these
  // entries when zombie/survivor ship to prod users.
  path.join('app', 'zombie', '[leagueId]'),
  path.join('app', 'zombie', 'universe'),
  path.join('app', 'survivor', '[leagueId]'),
  path.join('app', 'api', 'zombie'),
  path.join('app', 'api', 'survivor'),
  // Additional dev/preview/internal routes — safe to exclude, never called by production UI.
  path.join('app', 'dev'),                    // /dev/d6-preview — dev-only preview page
  path.join('app', 'api', 'internal'),        // /api/internal/* — internal routes with no UI callers
  path.join('app', 'app', 'simulation-lab'),  // /app/simulation-lab — lab UI (API side already excluded)
  path.join('app', 'app', 'zombie-universe'), // /app/zombie-universe/* — zombie universe pages (feature deferred)
  // World-cup bracket admin simulation tools — test/dev only, not called from any production UI.
  // sync-fixtures, sync-live, and integrity are also admin-only with no production UI callers.
  path.join('app', 'api', 'brackets', 'world-cup', '[challengeId]', 'admin'),
  // Auth debug endpoint — admin-only debug tool, no production UI callers.
  path.join('app', 'api', 'auth', 'admin-debug'),
  // Internal recompute worker endpoint; no production UI callers and costs one route.
  path.join('app', 'api', 'bracket', 'workers', 'health'),
  // Admin-only KPI rollup; consumed by components/admin/ChimmyKPIReadout which
  // is not mounted in any production page route. Excluded to free Vercel route budget.
  path.join('app', 'api', 'ai', 'analytics', 'rollup'),
  // Admin "Seed store" dev tool route. The Store UI exposes a Seed button, but
  // it is a developer-only seeding helper, not a production user action.
  path.join('app', 'api', 'marketplace', 'seed'),
  // AI provider registry/status endpoints — admin monitoring only, no production UI callers.
  // Callers are limited to internal admin diagnostics and /api/ai/tools (also excluded).
  path.join('app', 'api', 'ai', 'providers'),
  // AI tools discovery endpoint — only referenced as an error-message string in the tool registry;
  // no production UI ever fetches it. Excluded to reduce route budget.
  path.join('app', 'api', 'ai', 'tools'),
  // Big Brother game mode — deferred; not yet shipped to production users.
  // Exclude only the route-bearing page dirs; components/ stays because other
  // committed files may import shared BB UI components.
  path.join('app', 'big-brother', '[bblId]'),
  path.join('app', 'api', 'big-brother'),
  // Devy (development dynasty picks) — deferred; not yet shipped to production users.
  // Exclude only the route-bearing [leagueId] pages — NOT app/devy/components/
  // because CommissionerSettingsModal and C2CRosterClient import devy components directly.
  path.join('app', 'devy', '[leagueId]'),
  path.join('app', 'api', 'devy'),
  // Debug-only endpoints — no production UI callers; 2 routes freed.
  path.join('app', 'api', 'af-debug'),
  // ── Route-budget cleanup (2026-06-22) ────────────────────────────────────
  // Vercel hit the 2048-route cap (2049). The route-budget test already treats
  // app/admin + app/api/admin as excluded, but this build script never disabled
  // them, so they shipped and counted toward the cap. Reconcile here.
  //
  // Internal staff admin dashboard — not a customer surface. The few admin API
  // routes with real non-admin/lib callers are preserved via filesToKeep below
  // (sports/sync, fantasy-data/import, fantasy-data/status) plus the existing
  // automation keeps. No app/api/admin route is a vercel cron target.
  path.join('app', 'admin'),
  path.join('app', 'api', 'admin'),
  // Internal diagnostics / metrics / status / meta endpoints — verified to have
  // zero production (non-admin) fetch callers, no cron target, and no Chimmy/AI
  // tool-router reference. Not external health checks (those — /api/health,
  // /api/system/health — are intentionally NOT excluded).
  path.join('app', 'api', 'meta', 'logs'),
  path.join('app', 'api', 'intelligence', 'snapshot'),
  path.join('app', 'api', 'providers', 'status'),
  path.join('app', 'api', 'chaos-detector'),
  path.join('app', 'api', 'league-health'),
  path.join('app', 'api', 'league-meta'),
  path.join('app', 'api', 'platform', 'service-map'),
  path.join('app', 'api', 'ai', 'decision-log'),
  path.join('app', 'api', 'ai', 'validation'),
  path.join('app', 'api', 'ai', 'memory', 'quality'),
  // Internal cache-freshness + admin-gated system-health diagnostics. The ROOT
  // /api/health (external uptime probe) is intentionally NOT excluded.
  path.join('app', 'api', 'health', 'fantasycalc'),
  path.join('app', 'api', 'health', 'player-valuations'),
  path.join('app', 'api', 'system', 'health'),
]

const movedFiles = []
let cleanedUp = false
let buildFailure = null // { step, message, stack, exitCode, signal }
const filesToKeep = new Set([
  path.join('app', 'api', 'cron', '_auth.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'cron', 'waivers', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'admin', 'automation', 'health', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'admin', 'automation', 'waivers', 'run', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'ai', 'waivers', 'commissioner-insights', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'ai', 'waivers', 'recommend', 'route.ts').replace(/\\/g, '/'),
  // Admin routes with real non-admin/lib callers — keep these built even though
  // the rest of app/api/admin is disabled above.
  //   sports/sync + fantasy-data/import + fantasy-data/status ← lib/fantasy-data/providerHealth,
  //   lib/ai/leagueSportsGroundingPacket, app/api/chat/chimmy (live AI grounding).
  path.join('app', 'api', 'admin', 'sports', 'sync', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'admin', 'fantasy-data', 'import', 'route.ts').replace(/\\/g, '/'),
])

function directoryExists(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory()
  } catch {
    return false
  }
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true })
}

function movePath(fromPath, toPath) {
  ensureDir(path.dirname(toPath))
  fs.renameSync(fromPath, toPath)
}

function collectFilesUnderDir(rootPath) {
  if (!directoryExists(rootPath)) return []
  const discovered = []
  const stack = [rootPath]

  while (stack.length > 0) {
    const currentPath = stack.pop()
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolutePath)
        continue
      }
      discovered.push(absolutePath)
    }
  }

  return discovered
}

function safeRmSync(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true })
    return true
  } catch (err) {
    console.warn(
      `[vercel-next-build] Could not remove ${targetPath} (${err.code ?? err.message}) — continuing.`
    )
    return false
  }
}

// ── Manifest helpers ──────────────────────────────────────────────────────────
// A manifest.json written into backupRoot gives restoreNonProdRoutes() a
// crash-safe record of every { originalPath, backupPath } pair.  Even if the
// process is killed between disable and restore, the next run can recover from
// the manifest rather than trying to reverse-engineer paths from __-encoded
// filenames (which is ambiguous for files whose names already contain __).

function writeBackupManifest(entries) {
  try {
    const data = entries.map((e) => ({
      originalPath: e.routeFile,
      backupPath: e.backupPath,
    }))
    fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2), 'utf8')
  } catch (err) {
    console.warn(`[vercel-next-build] Could not write backup manifest: ${err.message}`)
  }
}

function readBackupManifest() {
  try {
    if (!fs.existsSync(manifestPath)) return null
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

// Run `git ls-files --deleted` after restore to surface any files that are
// still missing from the working tree.
function runPostRestoreGitCheck() {
  try {
    const deleted = require('child_process')
      .execSync('git ls-files --deleted', { cwd: repoRoot, encoding: 'utf8' })
      .trim()
    if (deleted) {
      console.warn(
        '[vercel-next-build] Post-restore safety check: tracked files still missing from disk:'
      )
      for (const line of deleted.split('\n').filter(Boolean)) {
        console.warn(`  ${line}`)
      }
      console.warn(
        '[vercel-next-build] Run: git restore $(git ls-files --deleted)  to recover them manually.'
      )
    } else {
      console.log(
        '[vercel-next-build] Post-restore safety check passed — no tracked files missing. ✓'
      )
    }
  } catch (err) {
    console.warn(`[vercel-next-build] Post-restore git check skipped: ${err.message}`)
  }
}

function ensureCleanBuildDir() {
  const removed = safeRmSync(nextBuildDir)
  if (removed && !fs.existsSync(nextBuildDir)) {
    return
  }

  if (isVercelBuild || process.env.AF_NEXT_DIST_DIR) {
    console.error(
      `[vercel-next-build] Could not clear build distDir ${nextBuildDir}. Close processes holding this directory and retry.`
    )
    process.exit(1)
  }

  resolvedDistDir = `.next-build-fix-${process.pid}`
  nextBuildDir = path.join(repoRoot, resolvedDistDir)
  safeRmSync(nextBuildDir)
  console.warn(
    `[vercel-next-build] Falling back to fresh local distDir ${resolvedDistDir} because .next-build-fix could not be cleared.`
  )
}

function writePlaceholder500(placeholderPath, shouldLog = false) {
  try {
    fs.mkdirSync(path.dirname(placeholderPath), { recursive: true })
    if (!fs.existsSync(placeholderPath)) {
      fs.writeFileSync(
        placeholderPath,
        '<!DOCTYPE html><html><head><title>Server Error</title></head><body><h1>500 - Server Error</h1></body></html>\n',
        'utf8',
      )
      if (shouldLog) {
        console.log('[vercel-next-build] Pre-seeded export/500.html placeholder')
      }
    }
  } catch (err) {
    console.warn(`[vercel-next-build] Could not pre-seed export/500.html: ${err.message}`)
  }
}

function runTypecheckBeforeBuild() {
  const skipTypecheck = process.env.AF_SKIP_BUILD_TYPECHECK === '1'
  if (skipTypecheck) {
    console.warn('[vercel-next-build] Skipping typecheck because AF_SKIP_BUILD_TYPECHECK=1')
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    console.log('[vercel-next-build] Running focused World Cup launch typecheck before next build')
    const child = spawn(
      process.execPath,
      [
        path.join(repoRoot, 'scripts', 'typecheck-world-cup-launch.cjs'),
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_OPTIONS: process.env.NODE_OPTIONS?.includes('--max-old-space-size=')
            ? process.env.NODE_OPTIONS
            : [process.env.NODE_OPTIONS, '--max-old-space-size=4096'].filter(Boolean).join(' '),
        },
      }
    )

    child.on('error', reject)
    child.on('close', (code, signal) => {
      if ((code ?? 0) !== 0 || signal) {
        reject(new Error(`typecheck exited with code ${code ?? 'null'} and signal ${signal ?? 'none'}`))
        return
      }
      resolve()
    })
  })
}

function disableNonProdRoutes() {
  safeRmSync(backupRoot)
  movedFiles.length = 0 // reset for safety — shouldn't re-enter, but be defensive

  for (const relativePath of routeDirsToDisable) {
    const sourcePath = path.join(repoRoot, relativePath)
    const routeFiles = collectFilesUnderDir(sourcePath)
    if (routeFiles.length === 0) continue

    for (const routeFile of routeFiles) {
      const relativeFile = path.relative(repoRoot, routeFile)
      const normalizedRelativeFile = relativeFile.replace(/\\/g, '/')
      if (filesToKeep.has(normalizedRelativeFile)) {
        continue
      }
      const backupPath = path.join(backupRoot, relativeFile.replace(/[\\/]/g, '__'))
      movePath(routeFile, backupPath)
      movedFiles.push({ routeFile, backupPath, relativeFile })
      console.log(`[vercel-next-build] Temporarily excluded ${relativeFile}`)
    }
  }

  console.log(`[vercel-next-build] Temporarily excluded ${movedFiles.length} non-prod file(s) total`)

  // Persist a manifest so restoreNonProdRoutes() can recover after a crash
  // (when the in-memory movedFiles array is gone but backup files remain).
  if (movedFiles.length > 0) {
    writeBackupManifest(movedFiles)
  }
}

function restoreNonProdRoutes() {
  if (cleanedUp) return
  cleanedUp = true

  // Normalise to { originalPath, backupPath }.
  // Prefer in-memory movedFiles (set in the same process run by disableNonProdRoutes).
  // Fall back to the on-disk manifest when in-memory state is empty (e.g. crash recovery).
  let entriesToRestore = movedFiles.map((e) => ({
    originalPath: e.routeFile,
    backupPath: e.backupPath,
  }))

  if (entriesToRestore.length === 0) {
    const manifest = readBackupManifest()
    if (manifest && manifest.length > 0) {
      console.warn(
        `[vercel-next-build] In-memory route list is empty — restoring ${manifest.length} file(s) from manifest.`
      )
      entriesToRestore = manifest
    }
  }

  if (entriesToRestore.length === 0) {
    // Nothing was disabled in this run and no manifest exists; clean up any stale dir.
    if (directoryExists(backupRoot)) safeRmSync(backupRoot)
    return
  }

  console.log(`[vercel-next-build] Restoring ${entriesToRestore.length} temporarily excluded file(s)...`)

  let restoredCount = 0
  let missingCount = 0
  const failedPaths = []

  // Reverse so that nested dirs restore leaf-first (mirrors disable order).
  for (const entry of [...entriesToRestore].reverse()) {
    if (!fs.existsSync(entry.backupPath)) {
      missingCount++
      console.warn(`[vercel-next-build] Backup file not found — skipping: ${entry.backupPath}`)
      continue
    }
    try {
      movePath(entry.backupPath, entry.originalPath)
      restoredCount++
    } catch (err) {
      failedPaths.push(entry.originalPath)
      console.error(
        `[vercel-next-build] Failed to restore ${entry.originalPath}: ${err.message}`
      )
    }
  }

  console.log(`[vercel-next-build] Restored ${restoredCount} temporarily excluded file(s)`)

  if (missingCount > 0) {
    console.warn(`[vercel-next-build] ${missingCount} backup file(s) were not found during restore.`)
  }

  if (failedPaths.length > 0) {
    // Leave the backup dir intact so the developer can recover manually.
    console.error(
      `[vercel-next-build] ${failedPaths.length} file(s) failed to restore — backup dir preserved: ${backupRoot}`
    )
  } else {
    // All files accounted for (restored or confirmed already gone) — clean up backup dir.
    safeRmSync(backupRoot)
  }

  runPostRestoreGitCheck()
}

function printFailureSummary() {
  if (!buildFailure) return
  console.error('[vercel-next-build] ────────────────────────────────────────────────────')
  console.error('[vercel-next-build] FINAL FAILURE SUMMARY')
  console.error(`[vercel-next-build] step:          ${buildFailure.step}`)
  console.error(`[vercel-next-build] exitCode:      ${buildFailure.exitCode ?? 'n/a'}`)
  console.error(`[vercel-next-build] signal:        ${buildFailure.signal ?? 'none'}`)
  console.error(`[vercel-next-build] error message: ${buildFailure.message}`)
  if (buildFailure.stack) {
    console.error(`[vercel-next-build] stack:\n${buildFailure.stack}`)
  }
  console.error('[vercel-next-build] See above for full logs.')
  console.error('[vercel-next-build] ────────────────────────────────────────────────────')
}

function writeBuildTailwindContentConfig() {
  const configPath = path.join(repoRoot, 'tailwind.config.ts')
  if (!fs.existsSync(configPath)) return null
  const original = fs.readFileSync(configPath, 'utf8')
  const productionContent = [
    "'./app/**/*.{js,ts,jsx,tsx,mdx}'",
    "'./components/**/*.{js,ts,jsx,tsx,mdx}'",
  ]
  const excluded = movedFiles
    .map((entry) => `!./${entry.relativeFile.replace(/\\/g, '/')}`)
    .map((value) => `'${value}'`)
  const next = original.replace(
    /content:\s*\[[\s\S]*?\],/,
    `content: [\n    ${[...productionContent, ...excluded].join(',\n    ')},\n  ],`
  )
  if (next === original) return null
  fs.writeFileSync(configPath, next, 'utf8')
  console.log(`[vercel-next-build] Excluded ${excluded.length} moved file(s) from Tailwind content scan`)
  return () => fs.writeFileSync(configPath, original, 'utf8')
}

function recoverStrandedBackup() {
  // Self-heal: if a previous build crashed before restoreNonProdRoutes() ran,
  // stale backup files may still exist. Restore them before proceeding.
  if (!directoryExists(backupRoot)) return

  const allBackupFiles = collectFilesUnderDir(backupRoot)
  // manifest.json is not a route file — skip it when counting stranded files.
  const strandedFiles = allBackupFiles.filter((f) => path.basename(f) !== MANIFEST_FILE)

  if (strandedFiles.length === 0) {
    safeRmSync(backupRoot)
    return
  }

  console.warn(
    `[vercel-next-build] Detected ${strandedFiles.length} stranded backup file(s) — restoring before build.`
  )

  // Prefer manifest-based recovery: exact original paths, no ambiguity.
  // Fall back to __-encoded filename decoding only if no manifest exists.
  const manifest = readBackupManifest()
  let recoveredCount = 0

  if (manifest) {
    for (const entry of manifest) {
      const { originalPath, backupPath } = entry
      if (!fs.existsSync(backupPath)) continue
      try {
        fs.mkdirSync(path.dirname(originalPath), { recursive: true })
        fs.renameSync(backupPath, originalPath)
        console.warn(`[vercel-next-build] Recovered ${path.relative(repoRoot, originalPath)}`)
        recoveredCount++
      } catch (err) {
        console.warn(
          `[vercel-next-build] Could not recover ${path.relative(repoRoot, originalPath)}: ${err.message}`
        )
      }
    }
  } else {
    // No manifest — best-effort decode of __-encoded filenames.
    // Note: this is ambiguous for files whose names naturally contain __.
    console.warn(
      '[vercel-next-build] No manifest found — attempting best-effort recovery from encoded filenames.'
    )
    for (const backupFile of strandedFiles) {
      const basename = path.basename(backupFile)
      const restoredRelative = basename.replace(/__/g, path.sep)
      const destPath = path.join(repoRoot, restoredRelative)
      try {
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.renameSync(backupFile, destPath)
        console.warn(`[vercel-next-build] Recovered ${restoredRelative}`)
        recoveredCount++
      } catch (err) {
        console.warn(`[vercel-next-build] Could not recover ${restoredRelative}: ${err.message}`)
      }
    }
  }

  console.warn(`[vercel-next-build] Recovered ${recoveredCount} stranded file(s).`)
  safeRmSync(backupRoot)
}

async function run() {
  // Self-heal stranded files from a previous crashed build.
  recoverStrandedBackup()

  // Avoid stale build-manifest/chunk issues in cached CI environments.
  // On Windows, a held handle can leave .next-build-fix partially intact; use a fresh
  // local distDir rather than building against corrupt output.
  ensureCleanBuildDir()
  try {
    await runTypecheckBeforeBuild()
  } catch (error) {
    buildFailure = {
      step: 'typecheck',
      message: error.message,
      stack: error.stack ?? null,
      exitCode: error.exitCode ?? null,
      signal: error.signal ?? null,
    }
    console.error('[vercel-next-build] Typecheck failed:', error.message)
    printFailureSummary()
    process.exit(1)
  }

  const patchStatus = patchManifestRace(repoRoot)
  if (patchStatus === 'skipped-missing') {
    console.warn('[vercel-next-build] pages-manifest-plugin.js not found — manifest race patch skipped.')
  } else if (patchStatus === 'skipped-shape-changed') {
    console.warn(
      '[vercel-next-build] Manifest race patch skipped — upstream plugin shape changed. ' +
        'Update ORIGINAL in scripts/patch-manifest-race.cjs if concurrent build hangs occur.'
    )
  }
  disableNonProdRoutes()
  const restoreTailwindConfig = writeBuildTailwindContentConfig()

  // Workaround: Next.js 14 on Windows + Node ≥22 silently fails to write
  // {distDir}/export/500.html during the pages-router static-render phase,
  // then throws ENOENT when it tries to rename it to server/pages/500.html.
  // Pre-seeding a minimal placeholder ensures the rename step always succeeds.
  // If Next.js generates the real 500.html, it overwrites this before renaming.
  const placeholder500 = path.join(nextBuildDir, 'export', '500.html')
  writePlaceholder500(placeholder500, true)

  const nextArgs = process.argv.slice(2)
  const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  let child
  const childEnv = {
    ...process.env,
    AF_NEXT_DIST_DIR: process.env.AF_NEXT_DIST_DIR || resolvedDistDir,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || '1',
    DISABLE_INSTRUMENTATION_DURING_BUILD:
      process.env.DISABLE_INSTRUMENTATION_DURING_BUILD || '1',
    NODE_OPTIONS: process.env.NODE_OPTIONS?.includes('--max-old-space-size=')
      ? process.env.NODE_OPTIONS
      : [process.env.NODE_OPTIONS, '--max-old-space-size=4096'].filter(Boolean).join(' '),
  }

  console.log(
    `[vercel-next-build] Build distDir=${childEnv.AF_NEXT_DIST_DIR} telemetryDisabled=${childEnv.NEXT_TELEMETRY_DISABLED}`,
  )

  try {
    child = spawn(process.execPath, [nextBin, 'build', ...nextArgs], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: childEnv,
    })
  } catch (error) {
    buildFailure = {
      step: 'next build',
      message: error.message,
      stack: error.stack ?? null,
      exitCode: null,
      signal: null,
    }
    console.error('[vercel-next-build] Failed to start next build:', error.message)
    if (restoreTailwindConfig) restoreTailwindConfig()
    restoreNonProdRoutes()
    printFailureSummary()
    process.exit(1)
  }

  const shutdown = (code) => {
    if (restoreTailwindConfig) restoreTailwindConfig()
    restoreNonProdRoutes()
    if (buildFailure) printFailureSummary()
    process.exit(code)
  }

  process.on('SIGINT', () => {
    child.kill('SIGINT')
    shutdown(130)
  })

  process.on('SIGTERM', () => {
    child.kill('SIGTERM')
    shutdown(143)
  })

  child.on('close', (code, signal) => {
    if ((code ?? 0) !== 0 || signal) {
      buildFailure = {
        step: 'next build',
        message: `next build exited with code ${code ?? 'null'} and signal ${signal ?? 'none'}`,
        exitCode: code ?? null,
        signal: signal ?? null,
      }
      console.error(
        `[vercel-next-build] next build exited with code ${code ?? 'null'} and signal ${signal ?? 'none'}`
      )
    }
    shutdown(code ?? 1)
  })

  child.on('error', (error) => {
    buildFailure = {
      step: 'next build',
      message: error.message,
      stack: error.stack ?? null,
      exitCode: null,
      signal: null,
    }
    shutdown(1)
  })
}

run()
