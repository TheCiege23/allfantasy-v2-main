/**
 * railway-postbuild-css-audit.cjs
 *
 * Read-only build diagnostic. Prints what `next build` actually emitted for the
 * root layout, so a missing stylesheet can be told apart from a missing manifest
 * entry without guessing from the served HTML.
 *
 * Also prints the opening bytes of a prerendered App Router document, which
 * distinguishes a build-time shell failure from a request-time streaming one.
 *
 * Never fails the build.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const TAILWIND_MARKER = '--tw-border-spacing-x'

function safe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function walkForHtml(dir, out, budget) {
  if (out.length >= budget) return
  for (const entry of safe(() => fs.readdirSync(dir, { withFileTypes: true }), [])) {
    if (out.length >= budget) return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkForHtml(full, out, budget)
    else if (entry.name.endsWith('.html')) out.push(full)
  }
}

function main() {
  const cwd = process.cwd()
  const distDir = process.env.AF_NEXT_DIST_DIR || '.next'
  const dist = path.join(cwd, distDir)

  console.log('[css-audit] distDir=%s exists=%s', distDir, fs.existsSync(dist))

  const globals = path.join(cwd, 'app', 'globals.css')
  const globalsSrc = safe(() => fs.readFileSync(globals, 'utf8'), '')
  console.log(
    '[css-audit] app/globals.css bytes=%s hasTailwindDirective=%s hasTwMarker=%s',
    globalsSrc.length || 'MISSING',
    globalsSrc.includes('@tailwind'),
    globalsSrc.includes(TAILWIND_MARKER),
  )

  // Tailwind's output is not in static/css. Scan the whole dist tree so an
  // inlined-into-JS or oddly-placed chunk cannot hide.
  const everywhere = []
  ;(function walkAll(dir, depth) {
    if (depth > 6 || everywhere.length > 40) return
    for (const entry of safe(() => fs.readdirSync(dir, { withFileTypes: true }), [])) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walkAll(full, depth + 1)
      else if (/\.(css|js)$/.test(entry.name)) {
        const body = safe(() => fs.readFileSync(full, 'utf8'), '')
        if (body.includes(TAILWIND_MARKER)) everywhere.push(path.relative(dist, full))
      }
    }
  })(dist, 0)
  console.log('[css-audit] files ANYWHERE in dist carrying the tailwind marker: %d %s',
    everywhere.length, JSON.stringify(everywhere.slice(0, 10)))

  const cssDir = path.join(dist, 'static', 'css')
  const cssFiles = safe(() => fs.readdirSync(cssDir), [])
  let total = 0
  let markerChunks = 0
  for (const f of cssFiles) {
    const p = path.join(cssDir, f)
    const size = safe(() => fs.statSync(p).size, 0)
    total += size
    const body = safe(() => fs.readFileSync(p, 'utf8'), '')
    const hasMarker = body.includes(TAILWIND_MARKER)
    if (hasMarker) {
      markerChunks++
      console.log('[css-audit]   TAILWIND-MARKER in %s (%s bytes)', f, size)
    }
  }
  console.log(
    '[css-audit] %d css chunk(s), %d total bytes, %d carry the tailwind marker',
    cssFiles.length,
    total,
    markerChunks,
  )

  const manifest = safe(
    () => JSON.parse(fs.readFileSync(path.join(dist, 'app-build-manifest.json'), 'utf8')),
    null,
  )
  if (manifest) {
    const pages = manifest.pages || {}
    for (const key of ['/layout', '/page']) {
      const entry = pages[key]
      if (!entry) {
        console.log('[css-audit]   %s -> ABSENT', key)
        continue
      }
      console.log('[css-audit]   %s -> %s', key, JSON.stringify(entry))
    }
  } else {
    console.log('[css-audit] app-build-manifest.json UNREADABLE')
  }

  // Does the compiled server output contain the root layout at all?
  // 'mode-readable' and 'scroll-smooth' appear only in app/layout.tsx's
  // <body>/<html> classNames, so their presence is direct evidence the root
  // layout was compiled, independent of any module-graph inference.
  const MARKERS = ['mode-readable', 'scroll-smooth', 'globals.css', '--tw-border-spacing-x']
  const found = Object.create(null)
  for (const m of MARKERS) found[m] = []
  ;(function scanServer(dir, depth) {
    if (depth > 8) return
    for (const entry of safe(() => fs.readdirSync(dir, { withFileTypes: true }), [])) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) scanServer(full, depth + 1)
      else if (/\.(js|json)$/.test(entry.name)) {
        const body = safe(() => fs.readFileSync(full, 'utf8'), '')
        if (!body) continue
        for (const m of MARKERS) {
          if (found[m].length < 4 && body.includes(m)) found[m].push(path.relative(dist, full))
        }
      }
    }
  })(path.join(dist, 'server'), 0)
  for (const m of MARKERS) {
    console.log('[css-audit] server output containing %s -> %d %s', m, found[m].length, JSON.stringify(found[m]))
  }

  // Build-time vs request-time shell: look at a prerendered document.
  const htmls = []
  walkForHtml(path.join(dist, 'server', 'app'), htmls, 3)
  console.log('[css-audit] prerendered html files sampled: %d', htmls.length)
  for (const h of htmls) {
    const head = safe(() => fs.readFileSync(h, 'utf8').slice(0, 150), '<unreadable>')
    console.log('[css-audit]   %s :: %s', path.relative(dist, h), JSON.stringify(head))
  }
}

try {
  main()
} catch (error) {
  console.log('[css-audit] audit failed (non-fatal):', error && error.message)
}
