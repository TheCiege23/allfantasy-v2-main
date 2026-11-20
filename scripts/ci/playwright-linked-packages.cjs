#!/usr/bin/env node
/**
 * Print the apt packages that the named Playwright browsers' own binaries cannot start without — one per line.
 *
 *   node scripts/ci/playwright-linked-packages.cjs chromium webkit
 *
 * Exit 0: the answer is known (empty output means nothing is missing).
 * Exit 2: it could not be determined — the caller must fall back to the full install, never treat it as "nothing".
 *
 * Why this exists (2026-11-20, mobile-smoke job 136336052767): `playwright install-deps webkit` on ubuntu-26.04 is
 * 185 packages / 140 MB — fonts and a whole gstreamer + ffmpeg codec stack. The one library WebKit could not start
 * without, libevent-2.1.so.7, was package ~114 in that queue. On a mirror serving ~57 KB/s the 25-minute apt phase
 * reached package 103 and stopped, and WebKit failed its launch check for want of a 146 kB package. Twenty minutes
 * earlier, on the same image, the same 140 MB came down in ten seconds and everything passed. The list was never
 * wrong; its ORDER was. So the install script asks this helper for the handful of packages the binaries actually
 * link against and installs those first.
 *
 * The answer is Playwright's own: `_validateHostRequirements` runs `ldd` over the browser's directories and maps each
 * missing library to a package with Playwright's per-distro table, the same check Playwright runs before a launch.
 * It is called directly because the browser cache (restored by actions/cache from whichever runner saved it) carries
 * a DEPENDENCIES_VALIDATED marker that makes Playwright skip that check on this machine — which is why the 11-20
 * failure was a raw loader error instead of Playwright's own "Host system is missing dependencies" message.
 *
 * When Playwright cannot map EVERY library it prints only the library names and no apt command — on ubuntu-26.04 that
 * is every run (see librariesFromMessage) — so the names are then mapped here with Playwright's own table, read from
 * the installed playwright-core. A library still unmapped is reported and skipped, not fatal: it is normally a
 * dependency of a mapped package.
 *
 * ⚠ It reaches `playwright-core/lib/coreBundle`, a listed export but not a documented API, and reads that table from
 * the bundle's source. Anything unexpected — the export moved, the message or the table changed shape, no library
 * mapped at all — exits 2 and the caller carries on with the full install exactly as before. Being wrong here can
 * only cost time, never a green run on missing libraries: the install script's launch check still decides.
 */
'use strict'

// Loaded by dlopen() only for H.264 playback. Playwright maps a missing libx264.so to this package, which pulls
// ffmpeg's whole codec stack (libavcodec alone is 10 MB) — exactly the slow download this helper exists to get in
// front of. The full install that follows still installs it; a browser starts without it.
const DLOPEN_ONLY_PACKAGES = new Set(['gstreamer1.0-libav'])
// The library Playwright checks with dlopen and maps to that package (MANUAL_LIBRARY_TO_PACKAGE_NAME_UBUNTU).
const DLOPEN_ONLY_LIBRARIES = new Set(['libx264.so'])

const PACKAGE_NAME = /^[a-z0-9][a-z0-9.+-]+$/

function cannot(reason) {
  process.stderr.write(`playwright-linked-packages: ${reason}\n`)
  process.exit(2)
}

/**
 * Pull the package list out of Playwright's "Host system is missing dependencies" message. It is drawn inside an
 * ASCII box, one package per line after `apt-get install`, joined with `\`. Returns null when the message carries no
 * apt command — Playwright prints "Missing libraries:" instead when it cannot map every library to a package.
 */
function packagesFromMessage(message) {
  const lines = String(message)
    .split('\n')
    .map((l) => l.replace(/^[\s║╔╚]+|[\s║╗╝═]+$/g, ''))
  const start = lines.findIndex((l) => /\bapt-get install\b/.test(l))
  if (start === -1) return null
  const out = []
  for (let i = start; i < lines.length; i++) {
    let line = lines[i]
    if (i === start) line = line.slice(line.indexOf('apt-get install') + 'apt-get install'.length)
    else if (!line || line.startsWith('<3')) break
    for (const token of line.split(/[\s\\]+/)) {
      if (!token) continue
      if (!PACKAGE_NAME.test(token)) return null
      out.push(token)
    }
  }
  return out.length ? out : null
}

/**
 * The library names from Playwright's "Missing libraries:" branch — what it prints when it cannot map EVERY missing
 * library to a package, and so prints no apt command at all.
 *
 * 🛑 THAT IS THE COMMON CASE ON ubuntu-26.04, NOT AN EDGE. Measured on this PR's own mobile-smoke run (job
 * 136367977317, 2026-11-20): WebKit was missing 36 libraries and Playwright 1.64.1 mapped all but one —
 * libgraphene-1.0.so.0, which is in no table of Playwright's because it is a dependency of libgtk-4-1 rather than a
 * package Playwright lists. One unmapped library was enough to withhold the whole apt command, so the first version of
 * this helper read every 26.04 run as "cannot tell" and the reordering never happened.
 */
function librariesFromMessage(message) {
  const lines = String(message)
    .split('\n')
    .map((l) => l.replace(/^[\s\u2551\u2554\u255A]+|[\s\u2551\u2557\u255D\u2550]+$/g, ''))
  const start = lines.findIndex((l) => l === 'Missing libraries:')
  if (start === -1) return null
  const out = []
  for (let i = start + 1; i < lines.length && lines[i]; i++) {
    if (!/^[A-Za-z0-9_.+-]+\.so(\.[0-9.]+)?$/.test(lines[i])) return null
    out.push(lines[i])
  }
  return out.length ? out : null
}

/**
 * Playwright's own library -> package table for this host, read from the installed playwright-core so it moves with
 * every upgrade instead of being copied here and going stale. It is module-private in the bundle, so it is read from
 * the source text; anything unexpected returns null and the caller falls back.
 */
function playwrightLibraryTable(hostPlatform) {
  let source
  try {
    source = require('node:fs').readFileSync(require.resolve('playwright-core/lib/coreBundle'), 'utf8')
  } catch {
    return null
  }
  const section = source.indexOf('src/server/registry/nativeDeps.ts')
  if (section === -1) return null
  let at = section
  for (;;) {
    at = source.indexOf(`"${hostPlatform}": {`, at + 1)
    if (at === -1) return null
    const lib = source.indexOf('lib2package: {', at)
    const next = source.indexOf('": {\n        tools:', at + hostPlatform.length + 6)
    // The platform's own block, not a later one: its lib2package must come before the next platform's tools list.
    if (lib !== -1 && (next === -1 || lib < next)) {
      const end = source.indexOf('}', lib)
      const table = {}
      for (const m of source.slice(lib, end).matchAll(/"([^"]+)":\s*"([^"]+)"/g)) table[m[1]] = m[2]
      return Object.keys(table).length ? table : null
    }
  }
}

async function main() {
  const browsers = process.argv.slice(2)
  if (!browsers.length) cannot('no browsers named')
  if (process.platform !== 'linux') cannot(`not Linux (${process.platform})`)

  let registry
  try {
    registry = require('playwright-core/lib/coreBundle').registry.registry
  } catch (e) {
    cannot(`playwright-core registry unavailable: ${e && e.message ? e.message : e}`)
  }
  if (!registry || typeof registry.findExecutable !== 'function') cannot('playwright-core registry has no findExecutable')

  const packages = new Set()
  for (const name of browsers) {
    const executable = registry.findExecutable(name)
    if (!executable || typeof executable._validateHostRequirements !== 'function') cannot(`no validator for ${name}`)
    if (!executable.directory) cannot(`${name} has no install directory`)
    // ⚠ Playwright's ldd scan silently skips a directory that does not exist, so a browser that was never
    // downloaded would read as "nothing missing". Absent is "cannot tell", not "fine".
    if (!require('node:fs').existsSync(executable.directory)) cannot(`${name} is not installed at ${executable.directory}`)
    try {
      await executable._validateHostRequirements('javascript')
    } catch (e) {
      const message = e && e.message ? e.message : String(e)
      let found = packagesFromMessage(message)
      if (!found) {
        const libraries = librariesFromMessage(message)
        const hostPlatform = (() => {
          try {
            return require('playwright-core/lib/coreBundle').utils.hostPlatform
          } catch {
            return undefined
          }
        })()
        const table = libraries && hostPlatform ? playwrightLibraryTable(hostPlatform) : null
        if (!libraries || !table) cannot(`could not read the missing packages for ${name} from Playwright's message:\n${message}`)
        found = []
        const unmapped = []
        for (const library of libraries) {
          if (DLOPEN_ONLY_LIBRARIES.has(library)) continue
          if (table[library]) found.push(table[library])
          else unmapped.push(library)
        }
        // Not fatal: the packages that ARE mapped are what the binaries link against, and the usual reason a library
        // is unmapped is that one of them depends on it (libgraphene <- libgtk-4-1), so apt brings it along. Being
        // wrong here costs only time: step 4's launch check, and the precheck that gates the shorter wait, decide.
        if (unmapped.length) process.stderr.write(`playwright-linked-packages: ${name}: no package known for ${unmapped.join(', ')}; expecting apt to bring them as dependencies\n`)
        if (!found.length) cannot(`none of ${name}'s missing libraries map to a package:\n${message}`)
      }
      for (const p of found) if (!DLOPEN_ONLY_PACKAGES.has(p)) packages.add(p)
    }
  }
  for (const p of packages) process.stdout.write(`${p}\n`)
}

if (require.main === module) {
  main().catch((e) => cannot(`unexpected error: ${e && e.stack ? e.stack : e}`))
}

module.exports = { packagesFromMessage, librariesFromMessage, playwrightLibraryTable, DLOPEN_ONLY_PACKAGES, DLOPEN_ONLY_LIBRARIES }
