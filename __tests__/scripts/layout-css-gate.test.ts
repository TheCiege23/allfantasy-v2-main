// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { checkLayoutCss, TAILWIND_MARKER, MIN_TAILWIND_BYTES } = require('../../scripts/lib/layout-css-gate.cjs') as {
  checkLayoutCss: (dist: string) => { ok: boolean; problems: string[]; info: Record<string, unknown> }
  TAILWIND_MARKER: string
  MIN_TAILWIND_BYTES: number
}

/*
 * The gate decides whether a Railway build may ship with the webpack cache on, so
 * every case below is a way a build can LOOK fine and serve an unstyled page. The
 * shapes are the real ones: a client reference manifest is JS assigning JSON to
 * globalThis.__RSC_MANIFEST[route], and `entryCSSFiles` maps an absolute entry
 * path to CSS files — strings in older Next, `{ path, inlined }` in newer.
 */

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const LAYOUT = '/app/app/layout'
const TAILWIND_CSS = `*,::before{${TAILWIND_MARKER}:0}` + 'a'.repeat(MIN_TAILWIND_BYTES)

type CssEntry = string | { path: string; inlined: boolean }

function makeDist(opts: {
  manifests?: Record<string, Record<string, CssEntry[]>>
  css?: Record<string, string>
}) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-css-gate-'))
  dirs.push(dist)
  const manifests = opts.manifests ?? {
    'page': { [LAYOUT]: ['static/css/tw.css'], '/app/app/page': [] },
  }
  for (const [route, entryCSSFiles] of Object.entries(manifests)) {
    const file = path.join(dist, 'server', 'app', `${route}_client-reference-manifest.js`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const body = JSON.stringify({ moduleLoading: { prefix: '/_next/' }, entryCSSFiles })
    fs.writeFileSync(
      file,
      `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/${route}"]=${body}`,
    )
  }
  for (const [rel, body] of Object.entries(opts.css ?? { 'static/css/tw.css': TAILWIND_CSS })) {
    fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true })
    fs.writeFileSync(path.join(dist, rel), body)
  }
  fs.writeFileSync(
    path.join(dist, 'app-build-manifest.json'),
    JSON.stringify({ pages: { '/layout': ['static/chunks/app/layout.js', 'static/css/tw.css'] } }),
  )
  return dist
}

describe('layout CSS gate', () => {
  it('passes a healthy build (string entries)', () => {
    const r = checkLayoutCss(makeDist({}))
    expect(r.problems).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('passes a healthy build whose entries are { path, inlined } objects', () => {
    const r = checkLayoutCss(
      makeDist({ manifests: { page: { [LAYOUT]: [{ path: 'static/css/tw.css', inlined: false }] } } }),
    )
    expect(r.ok).toBe(true)
  })

  it('recognises a Windows-shaped root layout key', () => {
    const r = checkLayoutCss(makeDist({ manifests: { page: { 'C:\\srv\\app\\layout': ['static/css/tw.css'] } } }))
    expect(r.ok).toBe(true)
  })

  it('FAILS when one route lost the layout CSS — the stale-cache symptom, on one page only', () => {
    const r = checkLayoutCss(
      makeDist({
        manifests: {
          page: { [LAYOUT]: ['static/css/tw.css'] },
          'trades/page': { [LAYOUT]: [] },
        },
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/1 of 2 manifest\(s\) list NO CSS.*trades/)
  })

  it('FAILS when a named CSS file is missing on disk', () => {
    const r = checkLayoutCss(makeDist({ css: {} }))
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/missing on disk: static\/css\/tw\.css/)
  })

  it('FAILS when the layout CSS is not the Tailwind sheet (no marker)', () => {
    const r = checkLayoutCss(makeDist({ css: { 'static/css/tw.css': 'a'.repeat(MIN_TAILWIND_BYTES * 2) } }))
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/Tailwind sheet/)
  })

  it('FAILS when the Tailwind sheet is near-empty (the 0-byte compile failure)', () => {
    const r = checkLayoutCss(makeDist({ css: { 'static/css/tw.css': `{${TAILWIND_MARKER}:0}` } }))
    expect(r.ok).toBe(false)
  })

  it('FAILS when no manifest names the root layout', () => {
    const r = checkLayoutCss(makeDist({ manifests: { page: { '/app/app/page': ['static/css/tw.css'] } } }))
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/no client reference manifest names a root-layout entry/)
  })

  it('FAILS on a dist with no client reference manifests at all', () => {
    const r = checkLayoutCss(makeDist({ manifests: {} }))
    expect(r.ok).toBe(false)
  })

  it('FAILS on an unparseable manifest rather than skipping it silently', () => {
    const dist = makeDist({})
    fs.writeFileSync(path.join(dist, 'server', 'app', 'broken_client-reference-manifest.js'), 'not a manifest')
    const r = checkLayoutCss(dist)
    expect(r.ok).toBe(false)
    expect(r.problems.join('\n')).toMatch(/could not be parsed/)
  })
})
