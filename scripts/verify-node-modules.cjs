/**
 * Assert that node_modules is actually usable — not merely present.
 *
 * 🛑 WHY THIS EXISTS, AND WHY IT IS NOT INSIDE THE POSTINSTALL. On 2026-09-02/03 the
 * shared checkout reached a state where `node_modules` looked installed and was
 * not, THREE times in one night, and nothing said so. `.prisma/client` was absent,
 * so every `@prisma/client` type resolved to nothing: ~398 TS2305 plus ~1,800
 * downstream implicit-any errors, on a repo whose real baseline is 145. Anyone
 * typechecking in that window measured the broken tree instead of their change.
 * `.bin` was absent too, which is worse than inconvenient — `npx <name>` then falls
 * through to the public REGISTRY, and this repo has already executed a stranger's
 * typo-guard package named `tsc` that way.
 *
 * One occurrence was traced to an install that never finished, so the repo's own
 * postinstall never ran at all. That is the point of this file: A CHECK THAT LIVES
 * INSIDE THE POSTINSTALL CANNOT CATCH AN INSTALL THAT NEVER REACHES THE POSTINSTALL.
 * Whatever guards this state must run at a moment that happens regardless of how
 * the tree got broken, which is why `prebuild` and `npm run doctor` call it.
 *
 * ⚠ ASSERT ON NAMED ENTRIES, NEVER ON COUNTS. Several count-based reads went wrong
 * in one night: `.bin` reported as 1 entry when it held 0 (the count included the
 * lister's own error line), 16 unmet dependencies when there were 8 (`npm ls` prints
 * each twice), and a `DONE=127` sentinel read as a result because the check tested a
 * sentinel's PRESENCE rather than its VALUE. So: named files, named binaries, named
 * packages — and every failure reports the NAMES, because a count cannot be acted on.
 */

const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const REPO_ROOT = path.join(__dirname, '..')

/*
 * 🛑 STAGED ROLLOUT. Report-only first: print loudly, exit 0. Flip to true to
 * make a broken tree fail the build.
 *
 * This is a CONSTANT and deliberately not an environment variable. An env-var
 * opt-out ships DISABLED in the environment where the failure is most likely and
 * most expensive — a fresh install in a clean Railway container, whose output is
 * a deploy — and this repo has already paid for that pattern: three real-data
 * suites ran unmocked against PRODUCTION for weeks behind a flag whose "set"
 * state was permanent, so the gate was effectively a constant that read as a
 * choice. A constant here makes enforcement a reviewable commit instead of an
 * invisible dashboard setting.
 *
 * Flip AFTER this has run green through several real Railway builds. As of
 * 2026-09-03 it has ZERO Railway runtime history.
 */
const ENFORCING = false

/** Big enough that a truncated or placeholder client fails; the real file is ~66 MB. */
const PRISMA_CLIENT_MIN_BYTES = 1024 * 1024

/** Cap on how many missing package names a single failure line will print. */
const MAX_NAMED = 15

const pass = (name, detail) => ({ ok: true, name, detail })
const fail = (name, detail) => ({ ok: false, name, detail })

/**
 * Did the install FINISH?
 *
 * ⚠ npm writes this hidden lockfile at the END of a successful install. Package
 * presence only tells you an install STARTED; this file tells you it finished.
 * One file, no counting, and it was absent during all three breakages tonight.
 */
function checkInstallFinished(root) {
  const marker = path.join(root, 'node_modules', '.package-lock.json')
  if (!fs.existsSync(marker)) {
    return fail(
      'install finished',
      'node_modules/.package-lock.json is missing. npm writes it at the END of a ' +
        'successful install, so the install did not complete. Fix: npm install'
    )
  }
  return pass('install finished', '.package-lock.json present')
}

/**
 * Is the tree COMPLETE?
 *
 * 🛑 `npm ls --depth=0` CANNOT ANSWER THIS AND WAS THE FIRST VERSION OF THIS CHECK.
 * It inspects only DECLARED DIRECT dependencies, so transitive packages are invisible
 * to it — measured on 2026-09-03, it reported 8 missing on a tree missing far more,
 * and would have passed it. That is the very failure this file exists to prevent, so
 * the assertion reads package-lock.json instead.
 *
 * ⚠ AND IT MUST SKIP PLATFORM-GATED ENTRIES OR IT CAN NEVER PASS. The lock lists every
 * platform's binaries — 162 of this repo's 1,043 top-level placements carry os/cpu or
 * optional (@esbuild/darwin-arm64, @img/sharp-libvips-linux-*, @rollup/rollup-linux-*).
 * npm correctly skips them on Windows. Requiring all 1,043 fails on every machine here,
 * which is the inverse of a check that cannot fail and gets disabled just as fast.
 */
function checkTreeComplete(root) {
  const lockPath = path.join(root, 'package-lock.json')
  if (!fs.existsSync(lockPath)) {
    // Cannot run the check. Say so; never report an unrun check as a pass.
    return fail('tree complete', 'NOT CHECKED — package-lock.json not found')
  }

  let packages
  try {
    packages = JSON.parse(fs.readFileSync(lockPath, 'utf8')).packages
  } catch (err) {
    return fail('tree complete', `NOT CHECKED — could not parse package-lock.json: ${err.message}`)
  }
  if (!packages) {
    return fail('tree complete', 'NOT CHECKED — package-lock.json has no "packages" map (lockfileVersion < 2?)')
  }

  const missing = []
  const optionalAbsent = []
  for (const key of Object.keys(packages)) {
    if (!key.startsWith('node_modules/')) continue
    const rest = key.slice('node_modules/'.length)
    // Top-level placements only: "x" or "@scope/x". Nested copies are npm's business.
    const isTopLevel = rest.startsWith('@') ? rest.split('/').length === 2 : !rest.includes('/')
    if (!isTopLevel) continue

    const entry = packages[key] || {}
    // os/cpu name another platform outright — npm was right to skip these.
    if (entry.os || entry.cpu) continue

    if (fs.existsSync(path.join(root, key, 'package.json'))) continue

    /*
     * ⚠ A BARE `optional: true` WITH NO os/cpu IS NOT A FAILURE, BUT IT IS NOT
     * SILENT EITHER. Skipping all optionals outright is wider than necessary and
     * would hide real damage to an optional package that IS installed here; the
     * middle ground is to let absence pass and NAME it, so a human can eyeball a
     * short list instead of trusting a silent skip. (These are the wasm fallbacks
     * — @emnapi/*, @napi-rs/wasm-runtime, @tybys/wasm-util — whose native binary
     * is present, so their absence is correct.)
     */
    if (entry.optional) optionalAbsent.push(rest)
    else missing.push(rest)
  }

  const named = (list) => {
    const shown = list.slice(0, MAX_NAMED).join(', ')
    return list.length > MAX_NAMED ? `${shown}, … and ${list.length - MAX_NAMED} more` : shown
  }

  if (missing.length > 0) {
    return fail(
      'tree complete',
      `${missing.length} required package(s) absent from node_modules: ${named(missing)}. Fix: npm install`
    )
  }
  const note = optionalAbsent.length
    ? ` (${optionalAbsent.length} optional absent, expected: ${named(optionalAbsent)})`
    : ''
  return pass('tree complete', `every required package-lock placement present${note}`)
}

/**
 * Does the generated Prisma client exist AND resolve?
 *
 * Two assertions in one because they fail differently: the .d.ts is what a TYPECHECK
 * reads (its absence is the ~2,200-error state), and the resolvable module is what
 * RUNTIME reads. A size floor sits under the .d.ts because an interrupted generate
 * leaves the file present but tiny, which plain existence calls healthy.
 */
function checkPrismaClient(root) {
  const file = path.join(root, 'node_modules', '.prisma', 'client', 'index.d.ts')
  if (!fs.existsSync(file)) {
    return fail(
      'prisma client',
      'node_modules/.prisma/client/index.d.ts is missing. Every @prisma/client type will ' +
        'resolve to nothing, so a typecheck reports thousands of errors that are not yours. ' +
        'Fix: node node_modules/prisma/build/index.js generate'
    )
  }
  const bytes = fs.statSync(file).size
  if (bytes < PRISMA_CLIENT_MIN_BYTES) {
    return fail(
      'prisma client',
      `node_modules/.prisma/client/index.d.ts is only ${bytes} bytes (expected > ` +
        `${PRISMA_CLIENT_MIN_BYTES}). A generate was interrupted. ` +
        'Fix: node node_modules/prisma/build/index.js generate'
    )
  }
  return pass('prisma client', `index.d.ts ${bytes} bytes`)
}

/** The client must actually load — existing on disk is not the same as importable. */
function checkPrismaResolves(root) {
  try {
    const req = createRequire(path.join(root, 'package.json'))
    const mod = req('@prisma/client')
    if (typeof mod.PrismaClient !== 'function') {
      return fail(
        'prisma resolves',
        "@prisma/client loaded but does not export a PrismaClient constructor. " +
          'Fix: node node_modules/prisma/build/index.js generate'
      )
    }
    return pass('prisma resolves', 'PrismaClient constructor available')
  } catch (err) {
    return fail('prisma resolves', `@prisma/client could not be loaded: ${err.message}. Fix: npm install`)
  }
}

/**
 * Are the .bin shims present?
 *
 * ⚠ A NAMED binary, not an entry count — `.bin` was reported as holding 1 entry on
 * 2026-09-02 when it held none. `tsc` is the right probe: it is what every
 * attestation in this repo runs, and an empty `.bin` is what silently redirects
 * `npx tsc` to the registry.
 */
function checkBinShims(root) {
  const probe = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
  if (!fs.existsSync(path.join(root, 'node_modules', '.bin', probe))) {
    return fail(
      '.bin shims',
      `node_modules/.bin/${probe} is missing, so npx-style invocations will not resolve — ` +
        '`npx <name>` can fall through to the public registry. Fix: npm install'
    )
  }
  return pass('.bin shims', `${probe} present`)
}

/**
 * Run every assertion. Pure: returns results, prints nothing, exits nothing.
 *
 * `root` is a parameter so the test suite can point this at a deliberately broken
 * fixture tree and confirm each assertion actually goes RED. A check that has only
 * ever been observed green is not evidence.
 */
function verifyNodeModules(root = REPO_ROOT) {
  return [
    checkInstallFinished(root),
    checkTreeComplete(root),
    checkPrismaClient(root),
    checkPrismaResolves(root),
    checkBinShims(root),
  ]
}

function report(results) {
  const failures = results.filter((r) => !r.ok)
  if (failures.length === 0) {
    /*
     * ⚠ PRINT THE DETAIL, NOT JUST THE NAME. The first version printed only the
     * assertion names on success, which silently discarded the one thing the
     * pass had to say — the named list of optional packages that are absent.
     * Computing a name and then not printing it is the same silent skip this
     * check exists to remove, just moved one layer down.
     */
    console.log('[verify-node-modules] OK')
    for (const r of results) console.log(`  ✓ ${r.name}: ${r.detail}`)
    return 0
  }
  console.error(
    [
      '',
      '[verify-node-modules] node_modules IS NOT USABLE — ' +
        `${failures.length} of ${results.length} assertions failed`,
      '',
      ...failures.map((f) => `  ✗ ${f.name}: ${f.detail}`),
      '',
      ENFORCING
        ? '  Failing the build. A broken tree produces measurements that are not about your change.'
        : '  REPORT-ONLY: continuing anyway. Flip ENFORCING in scripts/verify-node-modules.cjs to fail.',
      '',
    ].join('\n')
  )
  return ENFORCING ? 1 : 0
}

module.exports = { verifyNodeModules, report, ENFORCING, PRISMA_CLIENT_MIN_BYTES }

if (require.main === module) {
  process.exit(report(verifyNodeModules()))
}
