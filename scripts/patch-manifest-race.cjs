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

// The exact unpatched shape shipped by Next.js 14.
const ORIGINAL_DOUBLE_QUOTED = `        const writeMergedManifest = async (manifestPath, entries)=>{\n            await _promises.default.mkdir(_path.default.dirname(manifestPath), {\n                recursive: true\n            });\n            await _promises.default.writeFile(manifestPath, JSON.stringify({\n                ...await _promises.default.readFile(manifestPath, "utf8").then((res)=>JSON.parse(res)).catch(()=>({})),\n                ...entries\n            }, null, 2));\n        };`

/*
 * ⚠ NEXT 15.5 SHIPS THE SAME CODE WITH `'utf8'` IN SINGLE QUOTES, and that one
 * character was enough for every install and every production build to print
 * "upstream plugin shape changed" and skip the patch. Found 2026-11-19 on 15.5.29.
 * Both spellings are accepted; anything else still skips loudly.
 */
const ORIGINAL_SHAPES = [
  ORIGINAL_DOUBLE_QUOTED,
  ORIGINAL_DOUBLE_QUOTED.replace('"utf8"', "'utf8'"),
]

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

  const original = ORIGINAL_SHAPES.find((shape) => source.includes(shape))
  if (original) {
    fs.writeFileSync(pluginPath, source.replace(original, () => REPLACEMENT))
    console.log('[patch-manifest-race] Patched Next pages-manifest-plugin manifest merge race')
    return 'patched'
  }

  console.warn(
    '[patch-manifest-race] Skipped manifest race patch — upstream plugin shape changed. ' +
      'This is safe to ignore but may require updating ORIGINAL_SHAPES in scripts/patch-manifest-race.cjs.',
  )
  return 'skipped-shape-changed'
}

module.exports = { patchManifestRace }

// Run when invoked directly: node scripts/patch-manifest-race.cjs
if (require.main === module) {
  patchManifestRace(process.cwd())
}
