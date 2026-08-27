/**
 * railway-loader-cache-purge.cjs
 *
 * Railway mounts /app/node_modules/.cache as a persistent Docker cache volume
 * keyed to the service ID, so it survives every build and every commit.
 * next.config.js turns off webpack's own filesystem cache on Linux, but loader
 * caches live here and are not covered by that.
 *
 * The root layout's stylesheet has been missing from the build for months while
 * the Tailwind prebuild reports a clean 776KB compile, and the prebuild
 * regenerates byte-identical CSS every time — so a single poisoned entry keyed
 * on that content would be reused forever. app/globals.css still opens with
 * "v2 — bust stale postcss-loader cache" from an earlier attempt to dislodge it
 * by changing the bytes.
 *
 * Reports what is in there, then removes it. Never fails the build.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

function dirBytes(dir) {
  let total = 0
  let files = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else {
        files++
        try {
          total += fs.statSync(full).size
        } catch {}
      }
    }
  }
  return { total, files }
}

try {
  const cacheDir = path.join(process.cwd(), 'node_modules', '.cache')
  if (!fs.existsSync(cacheDir)) {
    console.log('[cache-purge] node_modules/.cache absent — nothing to purge')
  } else {
    const entries = fs.readdirSync(cacheDir, { withFileTypes: true })
    console.log('[cache-purge] node_modules/.cache contains %d entr(ies):', entries.length)
    for (const entry of entries) {
      const full = path.join(cacheDir, entry.name)
      const { total, files } = entry.isDirectory()
        ? dirBytes(full)
        : { total: fs.statSync(full).size, files: 1 }
      console.log('[cache-purge]   %s  %d bytes across %d file(s)', entry.name, total, files)
    }
    fs.rmSync(cacheDir, { recursive: true, force: true, maxRetries: 3 })
    console.log('[cache-purge] removed node_modules/.cache')
  }
} catch (error) {
  console.log('[cache-purge] purge failed (non-fatal):', error && error.message)
}
