/**
 * layout-css-gate.cjs
 *
 * FAILS a build whose root layout would be served without its stylesheet.
 *
 * scripts/railway-postbuild-css-audit.cjs prints the same facts and never fails;
 * this is the version that decides. It exists so the webpack cache can be on for
 * Railway builds (scripts/next-build.cjs): the cache was turned off in May on the
 * theory that a stale entry could drop the layout's CSS, and a cache is safe to
 * keep only if that outcome is caught before it ships.
 *
 * WHAT IT READS, and why not app-build-manifest.json alone: Next writes the
 * <link rel="stylesheet"> tags at request time from each route's
 * `*_client-reference-manifest.js` (`entryCSSFiles`), not from
 * app-build-manifest.json (see scripts/railway-patch-app-build-manifest.cjs).
 * So the gate checks those, and reports app-build-manifest's /layout as context.
 *
 * Passing means, all of:
 *   1. at least one client reference manifest exists under <dist>/server/app;
 *   2. at least one names a root-layout entry (".../app/layout");
 *   3. EVERY manifest that names one lists at least one CSS file for it — a
 *      route whose manifest lost the layout CSS renders unstyled on its own;
 *   4. every CSS file named that way exists on disk;
 *   5. one of them is the Tailwind sheet: >= MIN_TAILWIND_BYTES and carrying
 *      TAILWIND_MARKER. Production serves one 762,683-byte sheet with the marker
 *      (measured 2026-10-01); the floor matches railway-tailwind-prebuild.cjs.
 *
 * `entryCSSFiles` values are strings in older Next and `{ path, inlined }`
 * objects in newer; both are read.
 *
 * CLI: `node scripts/lib/layout-css-gate.cjs [distDir]` — exit 0 pass, 1 fail.
 * distDir defaults to AF_NEXT_DIST_DIR, then `.next`, like next.config.js does
 * for a production build.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const TAILWIND_MARKER = '--tw-border-spacing-x'
const MIN_TAILWIND_BYTES = 100_000
const MANIFEST_SUFFIX = '_client-reference-manifest.js'

function isRootLayoutEntry(entryKey) {
  return /(?:^|[\\/])app[\\/]layout$/.test(entryKey)
}

function cssPathOf(entry) {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && typeof entry.path === 'string') return entry.path
  return null
}

function parseClientReferenceManifest(source) {
  const match = source.match(/globalThis\.__RSC_MANIFEST\["(?:\\.|[^"\\])+"\]=(\{.*\});?\s*$/s)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function walkManifests(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkManifests(full, out)
    else if (entry.name.endsWith(MANIFEST_SUFFIX)) out.push(full)
  }
  return out
}

/**
 * @param {string} distDir absolute path to the Next dist directory
 * @returns {{ ok: boolean, problems: string[], info: object }}
 */
function checkLayoutCss(distDir) {
  const problems = []
  const info = {
    distDir,
    manifests: 0,
    unreadable: 0,
    withRootLayout: 0,
    withoutLayoutCss: [],
    layoutCss: [],
    appBuildManifestLayoutCss: null,
  }

  const manifests = walkManifests(path.join(distDir, 'server', 'app'), [])
  info.manifests = manifests.length
  if (manifests.length === 0) {
    problems.push(`no client reference manifests under ${path.join(distDir, 'server', 'app')}`)
    return { ok: false, problems, info }
  }

  const cssUnion = new Set()
  for (const file of manifests) {
    let manifest = null
    try {
      manifest = parseClientReferenceManifest(fs.readFileSync(file, 'utf8'))
    } catch {
      manifest = null
    }
    if (!manifest) {
      info.unreadable++
      continue
    }
    const entryCSSFiles = manifest.entryCSSFiles || {}
    const layoutKeys = Object.keys(entryCSSFiles).filter(isRootLayoutEntry)
    if (layoutKeys.length === 0) continue
    info.withRootLayout++
    let found = 0
    for (const key of layoutKeys) {
      for (const entry of Array.isArray(entryCSSFiles[key]) ? entryCSSFiles[key] : []) {
        const p = cssPathOf(entry)
        if (p && p.endsWith('.css')) {
          cssUnion.add(p)
          found++
        }
      }
    }
    if (found === 0) info.withoutLayoutCss.push(path.relative(distDir, file))
  }

  if (info.unreadable > 0) {
    problems.push(`${info.unreadable} client reference manifest(s) could not be parsed`)
  }
  if (info.withRootLayout === 0) {
    problems.push('no client reference manifest names a root-layout entry (.../app/layout)')
  }
  if (info.withoutLayoutCss.length > 0) {
    problems.push(
      `${info.withoutLayoutCss.length} of ${info.withRootLayout} manifest(s) list NO CSS for the root layout, e.g. ${info.withoutLayoutCss.slice(0, 3).join(', ')}`,
    )
  }

  let tailwindSheet = false
  for (const rel of [...cssUnion].sort()) {
    const abs = path.join(distDir, rel.replace(/^\/?_next\//, ''))
    let bytes = 0
    let marker = false
    try {
      const body = fs.readFileSync(abs, 'utf8')
      bytes = Buffer.byteLength(body)
      marker = body.includes(TAILWIND_MARKER)
    } catch {
      problems.push(`root-layout CSS file named in a manifest is missing on disk: ${rel}`)
      continue
    }
    info.layoutCss.push({ file: rel, bytes, marker })
    if (marker && bytes >= MIN_TAILWIND_BYTES) tailwindSheet = true
  }
  if (cssUnion.size > 0 && !tailwindSheet) {
    problems.push(
      `no root-layout CSS file is the Tailwind sheet (>= ${MIN_TAILWIND_BYTES} bytes carrying ${TAILWIND_MARKER})`,
    )
  }

  try {
    const abm = JSON.parse(fs.readFileSync(path.join(distDir, 'app-build-manifest.json'), 'utf8'))
    const layout = (abm.pages && abm.pages['/layout']) || []
    info.appBuildManifestLayoutCss = layout.filter((a) => String(a).endsWith('.css')).length
  } catch {
    info.appBuildManifestLayoutCss = null
  }

  return { ok: problems.length === 0, problems, info }
}

function report(result, log = console.log) {
  const { info } = result
  log(
    '[layout-css-gate] %s — %d manifest(s), %d name the root layout, %d without its CSS; app-build-manifest /layout css=%s',
    result.ok ? 'PASS' : 'FAIL',
    info.manifests,
    info.withRootLayout,
    info.withoutLayoutCss.length,
    info.appBuildManifestLayoutCss === null ? 'unreadable' : info.appBuildManifestLayoutCss,
  )
  for (const c of info.layoutCss) {
    log('[layout-css-gate]   %s %d bytes tailwind=%s', c.file, c.bytes, c.marker)
  }
  for (const p of result.problems) log('[layout-css-gate]   PROBLEM: %s', p)
}

module.exports = { checkLayoutCss, report, isRootLayoutEntry, parseClientReferenceManifest, TAILWIND_MARKER, MIN_TAILWIND_BYTES }

if (require.main === module) {
  const distDir = path.resolve(process.argv[2] || process.env.AF_NEXT_DIST_DIR || '.next')
  const result = checkLayoutCss(distDir)
  report(result)
  process.exit(result.ok ? 0 : 1)
}
