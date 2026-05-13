const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { patchManifestRace } = require('./patch-manifest-race.cjs')

const repoRoot = process.cwd()
const backupRoot = path.join(repoRoot, '.next-build-disabled-routes')
const isVercelBuild =
  process.env.VERCEL === '1' ||
  process.env.NOW_BUILDER ||
  process.env.VERCEL_URL
const resolvedDistDir = process.env.AF_NEXT_DIST_DIR || (isVercelBuild ? '.next' : '.next-build-fix')
const nextBuildDir = path.join(repoRoot, resolvedDistDir)
const routeDirsToDisable = [
  path.join('app', 'e2e'),
  path.join('app', 'tools', 'social-share-engine-harness'),
  path.join('app', 'tools', 'public-league-discovery-harness'),
  // Keep non-core diagnostic/dev surfaces out of production route budget.
  path.join('app', 'admin'),
  path.join('app', 'api', 'admin'),
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
  path.join('app', 'api', 'test-keys'),       // /api/test-keys  — diagnostic API key checker
  path.join('app', 'api', 'internal'),        // /api/internal/* — internal routes with no UI callers
  path.join('app', 'app', 'simulation-lab'),  // /app/simulation-lab — lab UI (API side already excluded)
  path.join('app', 'app', 'zombie-universe'), // /app/zombie-universe/* — zombie universe pages (feature deferred)
  // World-cup bracket admin simulation tools — test/dev only, not called from any production UI.
  // sync-fixtures, sync-live, and integrity are also admin-only with no production UI callers.
  path.join('app', 'api', 'brackets', 'world-cup', '[challengeId]', 'admin'),
  // Auth debug endpoint — admin-only debug tool, no production UI callers.
  path.join('app', 'api', 'auth', 'admin-debug'),
]

const movedFiles = []
let cleanedUp = false
const filesToKeep = new Set([
  path.join('app', 'api', 'cron', '_auth.ts').replace(/\\/g, '/'),
  // Production draft timer progression — must compile in local `npm run build` same as deploy.
  path.join('app', 'api', 'cron', 'draft-expired-timers', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'cron', 'waivers', 'route.ts').replace(/\\/g, '/'),
  // NBA/NHL playoff live sync — 5-min cron, must be deployed to production.
  path.join('app', 'api', 'cron', 'playoff-live-sync', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'admin', 'automation', 'health', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'admin', 'automation', 'waivers', 'run', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'ai', 'waivers', 'commissioner-insights', 'route.ts').replace(/\\/g, '/'),
  path.join('app', 'api', 'ai', 'waivers', 'recommend', 'route.ts').replace(/\\/g, '/'),
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
  } catch (err) {
    console.warn(
      `[vercel-next-build] Could not remove ${targetPath} (${err.code ?? err.message}) — continuing.`
    )
  }
}

function disableNonProdRoutes() {
  safeRmSync(backupRoot)

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
}

function restoreNonProdRoutes() {
  if (cleanedUp) return
  cleanedUp = true

  for (const entry of movedFiles.reverse()) {
    if (!fs.existsSync(entry.backupPath)) continue
    movePath(entry.backupPath, entry.routeFile)
    console.log(`[vercel-next-build] Restored ${entry.relativeFile}`)
  }

  safeRmSync(backupRoot)
}

function recoverStrandedBackup() {
  // Self-heal: if a previous build crashed before restoreNonProdRoutes() ran,
  // stale backup files may still exist. Restore them before proceeding.
  if (!directoryExists(backupRoot)) return
  const strandedFiles = collectFilesUnderDir(backupRoot)
  if (strandedFiles.length === 0) return
  console.warn(
    `[vercel-next-build] Detected ${strandedFiles.length} stranded backup file(s) — restoring before build.`
  )
  for (const backupFile of strandedFiles) {
    const basename = path.basename(backupFile)
    const restoredRelative = basename.replace(/__/g, path.sep)
    const destPath = path.join(repoRoot, restoredRelative)
    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.renameSync(backupFile, destPath)
      console.warn(`[vercel-next-build] Recovered ${restoredRelative}`)
    } catch (err) {
      console.warn(`[vercel-next-build] Could not recover ${restoredRelative}: ${err.message}`)
    }
  }
  safeRmSync(backupRoot)
}

function run() {
  // Self-heal stranded files from a previous crashed build.
  recoverStrandedBackup()

  // Avoid stale build-manifest/chunk issues in cached CI environments.
  // Guard: EPERM on Windows when a background process holds a handle on the dir.
  try {
    safeRmSync(nextBuildDir)
  } catch (err) {
    // safeRmSync already handles errors; this catch is a no-op safety net
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

  // Workaround: Next.js 14 on Windows + Node ≥22 silently fails to write
  // {distDir}/export/500.html during the pages-router static-render phase,
  // then throws ENOENT when it tries to rename it to server/pages/500.html.
  // Pre-seeding a minimal placeholder ensures the rename step always succeeds.
  // If Next.js generates the real 500.html, it overwrites this before renaming.
  const exportDir = path.join(nextBuildDir, 'export')
  const placeholder500 = path.join(exportDir, '500.html')
  try {
    fs.mkdirSync(exportDir, { recursive: true })
    if (!fs.existsSync(placeholder500)) {
      fs.writeFileSync(
        placeholder500,
        '<!DOCTYPE html><html><head><title>Server Error</title></head><body><h1>500 - Server Error</h1></body></html>\n',
        'utf8',
      )
      console.log('[vercel-next-build] Pre-seeded export/500.html placeholder')
    }
  } catch (err) {
    console.warn(`[vercel-next-build] Could not pre-seed export/500.html: ${err.message}`)
  }

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
      : [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' '),
    // Default to single static worker on Windows to avoid missing `server/pages/500.js`
    // during early `/500` prerender (see next.config `AF_NEXT_BUILD_STATIC_WORKERS`).
    ...(process.platform === 'win32'
      ? {
          AF_NEXT_BUILD_STATIC_WORKERS:
            process.env.AF_NEXT_BUILD_STATIC_WORKERS ?? '1',
        }
      : {}),
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
    console.error('[vercel-next-build] Failed to start next build:', error)
    restoreNonProdRoutes()
    process.exit(1)
  }

  /** Next / OS sometimes reports -1 on crash; process.exit(-1) shows as 4294967295 on Windows. */
  function normalizeExitCode(code, signal) {
    if (signal === 'SIGINT') return 130
    if (signal === 'SIGTERM') return 143
    if (code == null) return 1
    if (typeof code !== 'number' || code < 0 || code > 255) return 1
    return code
  }

  const shutdown = (code, signal) => {
    restoreNonProdRoutes()
    process.exit(normalizeExitCode(code, signal))
  }

  process.on('SIGINT', () => {
    child.kill('SIGINT')
    shutdown(130, 'SIGINT')
  })

  process.on('SIGTERM', () => {
    child.kill('SIGTERM')
    shutdown(143, 'SIGTERM')
  })

  child.on('close', (code, signal) => {
    if ((code ?? 0) !== 0 || signal) {
      console.error(
        `[vercel-next-build] next build exited with code ${code ?? 'null'} and signal ${signal ?? 'none'}`
      )
    } else {
      console.log('[vercel-next-build] next build completed successfully')
    }
    shutdown(code, signal)
  })

  child.on('error', (error) => {
    console.error('[vercel-next-build] Failed to start next build:', error)
    shutdown(1, null)
  })
}

run()
