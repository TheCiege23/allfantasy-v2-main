/**
 * next-build.cjs — `npm run build`.
 *
 * OFF RAILWAY this runs exactly the command `build` always ran, once, and exits
 * with its status. CI, local and Vercel-shaped builds are unchanged.
 *
 * ON RAILWAY it turns the webpack cache back on, safely (2026-10-01). Builds took
 * ~19-21 min, ~10 of them in a webpack compile that started cold every time:
 * next.config.js set `config.cache = false` on Railway since May, after a stale
 * cache entry was suspected of dropping the root layout's CSS. Two things make a
 * cache safe to keep, and this file does both:
 *
 *   1. PRIVATE COPY. Railpack mounts /app/.next/cache as a SHARED cache, and
 *      Railway builds overlapping commits in parallel (measured: two builds
 *      overlapping ~16 min). So each build copies the shared cache into a private
 *      directory, compiles against that, and copies it back — atomically, by
 *      rename — only after it passes. Two builds never write one cache at once.
 *
 *   2. GATE. scripts/lib/layout-css-gate.cjs fails a build whose root layout
 *      would be served without its stylesheet. A cache is published ONLY from a
 *      build that passed it, so a bad cache can never become the next build's.
 *
 * Any failure of the cached attempt — compile error, OOM, gate — wipes the shared
 * cache and rebuilds with the cache OFF, which is the exact pre-2026-10-01 build.
 * The worst case is therefore today's build plus the time the first attempt took,
 * never a new way to fail. The gate also runs on that fallback: a build that
 * ships no layout CSS fails, and the deploy already serving keeps serving.
 *
 * Switches (Railway variables; ⚠ writing one redeploys the service):
 *   AF_WEBPACK_CACHE=0            skip the cache, run the fallback path directly
 *   AF_SKIP_LAYOUT_CSS_GATE=1     emergency only: ship without the CSS gate
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const NEXT_BUILD_ARGS = [
  '--max-old-space-size=20480',
  '--require',
  './scripts/win-exfat-readlink-shim.cjs',
  'node_modules/next/dist/bin/next',
  'build',
]

/** Where Railpack mounts the Next cache: /app/.next/cache, independent of distDir. */
const SHARED_CACHE_SUBDIR = path.join('.next', 'cache', 'af-webpack')

function isRailwayBuild(env) {
  return !!(
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_ENVIRONMENT ||
    env.RAILWAY_SERVICE_ID ||
    env.RAILWAY_DEPLOYMENT_ID ||
    env.RAILWAY_GIT_COMMIT_SHA
  )
}

function dirHasEntries(dir) {
  try {
    return fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}

function dirBytes(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else {
        try {
          total += fs.statSync(p).size
        } catch {
          /* raced away */
        }
      }
    }
  }
  return total
}

const mb = (n) => `${Math.round(n / 1048576)} MB`

/**
 * The Railway path, with every side effect injected so it can be tested without
 * webpack. Returns the exit status.
 *
 * deps: { build(env) -> status, gate() -> { ok, problems }, seed() -> bool (warm),
 *         publish() -> void, discardShared() -> void, cleanup() -> void,
 *         log(...args), skipCache: bool, skipGate: bool, cacheDir: string }
 */
function railwayBuild(deps) {
  const { build, gate, seed, publish, discardShared, cleanup, log, skipCache, skipGate, cacheDir } = deps
  const gateOk = () => {
    if (skipGate) {
      log('[next-build] ⚠ AF_SKIP_LAYOUT_CSS_GATE=1 — layout CSS gate SKIPPED')
      return true
    }
    return gate().ok
  }

  try {
    if (!skipCache) {
      const warm = seed()
      log(`[next-build] attempt 1: webpack cache ON (${warm ? 'warm' : 'cold'})`)
      const status = build({ AF_WEBPACK_CACHE_DIR: cacheDir })
      if (status === 0 && gateOk()) {
        publish()
        return 0
      }
      log(
        `[next-build] attempt 1 ${status === 0 ? 'FAILED the layout CSS gate' : `exited ${status}`} — ` +
          'discarding the shared cache and rebuilding with the cache OFF',
      )
      discardShared()
    } else {
      log('[next-build] AF_WEBPACK_CACHE=0 — webpack cache OFF')
    }

    const status = build({ AF_WEBPACK_CACHE_DIR: '' })
    if (status !== 0) return status
    return gateOk() ? 0 : 1
  } finally {
    cleanup()
  }
}

function runNextBuild(extraEnv) {
  const env = { ...process.env, ...extraEnv }
  if (!env.AF_WEBPACK_CACHE_DIR) delete env.AF_WEBPACK_CACHE_DIR
  const r = spawnSync(process.execPath, NEXT_BUILD_ARGS, { stdio: 'inherit', env, cwd: process.cwd() })
  if (r.error) {
    console.error('[next-build] could not start next build:', r.error.message)
    return 1
  }
  return r.status === null ? 1 : r.status
}

function main() {
  if (!isRailwayBuild(process.env)) {
    process.exit(runNextBuild({}))
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { checkLayoutCss, report } = require('./lib/layout-css-gate.cjs')
  const cwd = process.cwd()
  const shared = path.join(cwd, SHARED_CACHE_SUBDIR)
  // Outside /app, so it can never be copied into the runtime image.
  const cacheDir = path.join(os.tmpdir(), `af-webpack-cache-${process.pid}`)
  const distDir = path.join(cwd, process.env.AF_NEXT_DIST_DIR || '.next')
  const log = (...a) => console.log(...a)

  const status = railwayBuild({
    cacheDir,
    log,
    skipCache: process.env.AF_WEBPACK_CACHE === '0',
    skipGate: process.env.AF_SKIP_LAYOUT_CSS_GATE === '1',
    build: (extra) => {
      const t = Date.now()
      const s = runNextBuild(extra)
      log(`[next-build] next build exited ${s} after ${Math.round((Date.now() - t) / 1000)}s`)
      return s
    },
    gate: () => {
      const r = checkLayoutCss(distDir)
      report(r, log)
      return r
    },
    seed: () => {
      fs.rmSync(cacheDir, { recursive: true, force: true })
      if (!dirHasEntries(shared)) {
        fs.mkdirSync(cacheDir, { recursive: true })
        log(`[next-build] no shared cache at ${shared}`)
        return false
      }
      const t = Date.now()
      try {
        fs.cpSync(shared, cacheDir, { recursive: true })
        log(`[next-build] seeded ${mb(dirBytes(cacheDir))} from the shared cache in ${Date.now() - t}ms`)
        return true
      } catch (e) {
        log('[next-build] could not seed from the shared cache, building cold:', e.message)
        fs.rmSync(cacheDir, { recursive: true, force: true })
        fs.mkdirSync(cacheDir, { recursive: true })
        return false
      }
    },
    publish: () => {
      // Copy beside the target, then swap by rename, so a concurrent build reading
      // the shared cache sees the old one or the new one, never half of each.
      // Never fails the build: an unpublished cache only costs the next build time.
      const tag = `${process.pid}-${Date.now()}`
      const staging = `${shared}.staging-${tag}`
      const retired = `${shared}.retired-${tag}`
      try {
        const t = Date.now()
        fs.mkdirSync(path.dirname(shared), { recursive: true })
        fs.cpSync(cacheDir, staging, { recursive: true })
        if (fs.existsSync(shared)) fs.renameSync(shared, retired)
        fs.renameSync(staging, shared)
        log(`[next-build] published ${mb(dirBytes(shared))} to the shared cache in ${Date.now() - t}ms`)
      } catch (e) {
        log('[next-build] could not publish the cache (next build starts cold):', e.message)
      } finally {
        fs.rmSync(staging, { recursive: true, force: true })
        fs.rmSync(retired, { recursive: true, force: true })
      }
    },
    discardShared: () => {
      try {
        fs.rmSync(shared, { recursive: true, force: true })
      } catch (e) {
        log('[next-build] could not discard the shared cache:', e.message)
      }
    },
    cleanup: () => fs.rmSync(cacheDir, { recursive: true, force: true }),
  })
  process.exit(status)
}

module.exports = { railwayBuild, isRailwayBuild, NEXT_BUILD_ARGS, SHARED_CACHE_SUBDIR }

if (require.main === module) main()
