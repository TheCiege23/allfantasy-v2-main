const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { patchManifestRace } = require('./patch-manifest-race.cjs')

const repoRoot = process.cwd()
const backupRoot = path.join(repoRoot, '.next-build-disabled-routes')
const nextBuildDir = path.join(repoRoot, '.next')
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
]

const movedFiles = []
let cleanedUp = false
const filesToKeep = new Set([
  path.join('app', 'api', 'cron', '_auth.ts').replace(/\\/g, '/'),
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

function disableNonProdRoutes() {
  fs.rmSync(backupRoot, { recursive: true, force: true })

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

  fs.rmSync(backupRoot, { recursive: true, force: true })
}

function run() {
  // Avoid stale build-manifest/chunk issues in cached CI environments.
  fs.rmSync(nextBuildDir, { recursive: true, force: true })
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

  const nextArgs = process.argv.slice(2)
  const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  let child
  const childEnv = {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS?.includes('--max-old-space-size=')
      ? process.env.NODE_OPTIONS
      : [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' '),
  }

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

  const shutdown = (code) => {
    restoreNonProdRoutes()
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
      console.error(
        `[vercel-next-build] next build exited with code ${code ?? 'null'} and signal ${signal ?? 'none'}`
      )
    }
    shutdown(code ?? 1)
  })

  child.on('error', (error) => {
    console.error('[vercel-next-build] Failed to start next build:', error)
    shutdown(1)
  })
}

run()
