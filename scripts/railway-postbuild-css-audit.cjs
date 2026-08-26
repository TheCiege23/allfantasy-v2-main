/**
 * railway-postbuild-css-audit.cjs
 *
 * Read-only build diagnostic. Prints what `next build` actually emitted for the
 * root layout, so a missing stylesheet can be told apart from a missing manifest
 * entry without guessing from the served HTML.
 *
 * Never fails the build.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

function safe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function main() {
  const cwd = process.cwd()
  const distDir = process.env.AF_NEXT_DIST_DIR || '.next'
  const dist = path.join(cwd, distDir)

  console.log('[css-audit] distDir=%s exists=%s', distDir, fs.existsSync(dist))

  const globals = path.join(cwd, 'app', 'globals.css')
  console.log('[css-audit] app/globals.css bytes=%s', safe(() => fs.statSync(globals).size, 'MISSING'))

  const cssDir = path.join(dist, 'static', 'css')
  const cssFiles = safe(() => fs.readdirSync(cssDir), [])
  console.log('[css-audit] emitted %d css chunk(s) in %s/static/css:', cssFiles.length, distDir)
  for (const f of cssFiles) {
    console.log('[css-audit]   %s  %s bytes', f, safe(() => fs.statSync(path.join(cssDir, f)).size, '?'))
  }

  const manifestPath = path.join(dist, 'app-build-manifest.json')
  const manifest = safe(() => JSON.parse(fs.readFileSync(manifestPath, 'utf8')), null)
  if (!manifest) {
    console.log('[css-audit] app-build-manifest.json UNREADABLE at %s', manifestPath)
    return
  }
  const pages = manifest.pages || {}
  const keys = Object.keys(pages)
  console.log('[css-audit] app-build-manifest entries=%d', keys.length)
  for (const key of ['/layout', '/page', '/not-found']) {
    const entry = pages[key]
    if (!entry) {
      console.log('[css-audit]   %s -> ABSENT', key)
      continue
    }
    const css = entry.filter((f) => String(f).endsWith('.css'))
    console.log('[css-audit]   %s -> %d files, %d css: %s', key, entry.length, css.length, JSON.stringify(css))
  }
  const anyCss = keys.filter((k) => (pages[k] || []).some((f) => String(f).endsWith('.css')))
  console.log('[css-audit] entries carrying ANY css: %d (%s)', anyCss.length, JSON.stringify(anyCss.slice(0, 8)))
}

try {
  main()
} catch (error) {
  console.log('[css-audit] audit failed (non-fatal):', error && error.message)
}
