/**
 * patch-manifest-race.cjs
 *
 * Applies a file-locking patch to Next.js's `pages-manifest-plugin.js` so that
 * concurrent webpack workers cannot corrupt the pages manifest during parallel
 * route compilation — the root cause of the "dev server hangs compiling any
 * route" symptom on Windows and slow-disk environments.
 *
 * The patch adds an exclusive-open lock file (`<manifest>.lock`) around every
 * manifest write.  Attempts spin-wait with 400 × 25 ms (≤ 10 s) before giving
 * up with a clear diagnostic error.
 *
 * Idempotent — safe to run multiple times.  Called by:
 *   • postinstall  (package.json)  → self-heals after every `npm install`
 *   • vercel-next-build.cjs        → applied before every production build
 *
 * Run directly:  node scripts/patch-manifest-race.cjs
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const PLUGIN_REL = path.join(
  'node_modules',
  'next',
  'dist',
  'build',
  'webpack',
  'plugins',
  'pages-manifest-plugin.js',
)

// The exact unpatched shape shipped by Next.js ≥14.
const ORIGINAL = `        const writeMergedManifest = async (manifestPath, entries)=>{\n            await _promises.default.mkdir(_path.default.dirname(manifestPath), {\n                recursive: true\n            });\n            await _promises.default.writeFile(manifestPath, JSON.stringify({\n                ...await _promises.default.readFile(manifestPath, "utf8").then((res)=>JSON.parse(res)).catch(()=>({})),\n                ...entries\n            }, null, 2));\n        };`

// An older revision of the patch (mkdir outside the lock — now superseded).
const OLD_PATCHED = `        const writeMergedManifest = async (manifestPath, entries)=>{\n            const lockPath = manifestPath + ".lock";\n            const acquireManifestLock = async ()=>{\n                for(let attempt = 0; attempt < 400; attempt++){\n                    try {\n                        return await _promises.default.open(lockPath, "wx");\n                    } catch (error) {\n                        if (!error || error.code !== "EEXIST") throw error;\n                        await new Promise((resolve)=>setTimeout(resolve, 25));\n                    }\n                }\n                throw new Error("__AF_MANIFEST_LOCK_PATCH__: timed out acquiring Next manifest lock for " + manifestPath);\n            };\n            const lockHandle = await acquireManifestLock();\n            try {\n                await _promises.default.mkdir(_path.default.dirname(manifestPath), {\n                    recursive: true\n                });\n                await _promises.default.writeFile(manifestPath, JSON.stringify({\n                    ...await _promises.default.readFile(manifestPath, "utf8").then((res)=>JSON.parse(res)).catch(()=>({})),\n                    ...entries\n                }, null, 2));\n            } finally {\n                await lockHandle.close().catch(()=>{});\n                await _promises.default.unlink(lockPath).catch(()=>{});\n            }\n        };`

// Current (canonical) patched shape — mkdir before acquiring the lock so the
// directory always exists when the write runs.
const REPLACEMENT = `        const writeMergedManifest = async (manifestPath, entries)=>{\n            await _promises.default.mkdir(_path.default.dirname(manifestPath), {\n                recursive: true\n            });\n            const lockPath = manifestPath + ".lock";\n            const acquireManifestLock = async ()=>{\n                for(let attempt = 0; attempt < 400; attempt++){\n                    try {\n                        return await _promises.default.open(lockPath, "wx");\n                    } catch (error) {\n                        if (!error || error.code !== "EEXIST") throw error;\n                        await new Promise((resolve)=>setTimeout(resolve, 25));\n                    }\n                }\n                throw new Error("__AF_MANIFEST_LOCK_PATCH__: timed out acquiring Next manifest lock for " + manifestPath);\n            };\n            const lockHandle = await acquireManifestLock();\n            try {\n                await _promises.default.writeFile(manifestPath, JSON.stringify({\n                    ...await _promises.default.readFile(manifestPath, "utf8").then((res)=>JSON.parse(res)).catch(()=>({})),\n                    ...entries\n                }, null, 2));\n            } finally {\n                await lockHandle.close().catch(()=>{});\n                await _promises.default.unlink(lockPath).catch(()=>{});\n            }\n        };`

/**
 * Apply (or verify) the manifest-write lock patch.
 *
 * @param {string} [repoRoot] - Absolute path to the repo root.  Defaults to cwd().
 * @returns {'patched'|'already-current'|'skipped-missing'|'skipped-shape-changed'} Status string.
 */
function patchManifestRace(repoRoot) {
  const root = repoRoot || process.cwd()
  const pluginPath = path.join(root, PLUGIN_REL)

  /*
   * ⚠ NEVER PATCH A BUNDLER INTERNAL IN A PRODUCTION BUILD.
   *
   * This rewrites Next's `pages-manifest-plugin.js` — the plugin that writes
   * BOTH `pages-manifest.json` AND `app-paths-manifest.json` — to wrap every
   * write in an exclusive lock file that gives up after 400 x 25ms and throws.
   * The merge is `{...existing, ...entries}`, so a write that never happens is
   * not an error anyone sees: those entries are simply absent from the manifest.
   *
   * Measured on Railway production 2026-08-22, via /api/af-debug/headers?build=1:
   *     layoutPresentInBuild:            true   (3 of 983 server chunks)
   *     appBuildManifest.hasLayoutKey:   true
   *     appPathsManifest.hasRootLayout:  FALSE
   *
   * The root layout compiled and is missing from app-paths-manifest. Without
   * that entry the server renders pages with no root layout, which is both
   * observed symptoms at once: HTML with no <html>/<body> (they come from the
   * layout), and no <SessionProvider> (it is inside the layout), so every
   * `useSession()` consumer gets `undefined` and blanks the page.
   *
   * This script's own docstring scopes it to "the dev server hangs compiling any
   * route" on WINDOWS AND SLOW-DISK ENVIRONMENTS, and names its callers as
   * postinstall and `vercel-next-build.cjs`. It was never meant to run inside a
   * Linux production build — it reached Railway only because postinstall fires
   * on `npm ci`. The lock it adds solves a problem Linux CI does not have, and
   * can drop manifest entries, which is strictly worse than the race it prevents.
   *
   * Kept for local Windows development, where it earns its place. Skipped
   * wherever a real build runs.
   */
  const isCi = process.env.CI === 'true' || process.env.CI === '1'
  const isRailway = !!(
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RAILWAY_DEPLOYMENT_ID ||
    process.env.RAILWAY_GIT_COMMIT_SHA
  )
  if (process.platform !== 'win32' || isCi || isRailway) {
    console.log(
      `[patch-manifest-race] skipped (platform=${process.platform} ci=${isCi} railway=${isRailway}) — ` +
        'the manifest lock is a Windows dev-server workaround and must not alter a production build',
    )
    return 'skipped-not-windows-dev'
  }

  if (!fs.existsSync(pluginPath)) {
    return 'skipped-missing'
  }

  const source = fs.readFileSync(pluginPath, 'utf8')

  if (source.includes('__AF_MANIFEST_LOCK_PATCH__')) {
    if (source.includes(OLD_PATCHED)) {
      // Upgrade old patch to current.
      fs.writeFileSync(pluginPath, source.replace(OLD_PATCHED, REPLACEMENT))
      console.log('[patch-manifest-race] Upgraded Next pages-manifest-plugin to current lock patch')
      return 'patched'
    }
    // Already current.
    return 'already-current'
  }

  if (source.includes(ORIGINAL)) {
    fs.writeFileSync(pluginPath, source.replace(ORIGINAL, REPLACEMENT))
    console.log('[patch-manifest-race] Patched Next pages-manifest-plugin manifest merge race')
    return 'patched'
  }

  console.warn(
    '[patch-manifest-race] Skipped manifest race patch — upstream plugin shape changed. ' +
      'This is safe to ignore but may require updating ORIGINAL in scripts/patch-manifest-race.cjs.',
  )
  return 'skipped-shape-changed'
}

module.exports = { patchManifestRace }

// Run when invoked directly: node scripts/patch-manifest-race.cjs
if (require.main === module) {
  patchManifestRace(process.cwd())
}
