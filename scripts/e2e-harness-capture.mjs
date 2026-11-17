#!/usr/bin/env node
/**
 * Screenshot the DB-free league harnesses — Campus to Canton, Devy, IDP salary cap and the tournament app with its
 * commissioner dashboard — for visual review: frame × mode × width.
 *
 *   node scripts/e2e-harness-capture.mjs --base-url http://127.0.0.1:3317 --out <dir>
 *     [--harnesses c2c,devy,idp,tournament] [--frames roster,picks] [--modes light,dark] [--widths phone,desktop]
 *     [--chromium <path>]   (or AF_CAPTURE_CHROMIUM, when the installed Playwright cannot find its own browser)
 *
 * Writes <out>/<harness>/<frame>-<mode>-<width>.jpg plus <out>/<harness>/report.json.
 *
 * Each harness page (app/e2e/<harness>/…) renders the REAL league screen against a `next dev` you started
 * yourself; this script answers the screen's /api/ reads from the harness fixtures. The fixtures are TypeScript,
 * typed against the app's own response types, so they are read through `scripts/e2e-harness-api.ts` (run with
 * tsx) rather than copied here. Every other /api/ call gets a 503 and every request off the dev server's origin a
 * 404, so a capture reaches no database and no provider.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL, `allfantasy.ai` and its subdomains are refused, and
 * /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES A FRAME IT CANNOT VOUCH FOR: a Next.js error overlay, an <html> whose data-mode is not the mode
 * asked for, a page with next to no text, or a frame that asked for a fed route and got none. The report also
 * lists every /api/ path a frame asked for that no fixture answers — that is the list to grow the fixtures from.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 1000 } }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const list = (v, all) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : all)

const baseUrl = arg('base-url')
const out = arg('out')
if (!baseUrl || !out) {
  console.error('usage: --base-url <local dev server> --out <dir>  (no defaults on purpose)')
  process.exit(2)
}
const origin = new URL(baseUrl).origin
const host = new URL(baseUrl).hostname
if (host === 'allfantasy.ai' || host.endsWith('.allfantasy.ai')) {
  console.error(`refusing ${host}: this harness never runs against production`)
  process.exit(2)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tsx = path.join(root, 'node_modules', '.bin', 'tsx')
/** { [harness]: { routes: [{ path, query?, body }], frames: [{ name, path }] } } */
const HARNESSES = JSON.parse(execFileSync(tsx, [path.join(root, 'scripts', 'e2e-harness-api.ts')], { cwd: root, maxBuffer: 1 << 26 }).toString())

const harnesses = list(arg('harnesses'), Object.keys(HARNESSES))
const frameFilter = arg('frames') ? new Set(list(arg('frames'), [])) : null
const modes = list(arg('modes'), ['light', 'dark'])
const widths = list(arg('widths'), Object.keys(WIDTHS))
for (const h of harnesses) if (!HARNESSES[h]) { console.error(`unknown harness ${h} (have: ${Object.keys(HARNESSES).join(', ')})`); process.exit(2) }
for (const m of modes) if (!HTML_MODE[m]) { console.error(`unknown mode ${m}`); process.exit(2) }
for (const w of widths) if (!WIDTHS[w]) { console.error(`unknown width ${w}`); process.exit(2) }

/** The first route whose path matches and whose every query entry is on the request; see app/e2e/harnessApi.ts. */
function answer(routes, url) {
  return routes.find((r) => r.path === url.pathname && Object.entries(r.query ?? {}).every(([k, v]) => url.searchParams.get(k) === v))
}

const executablePath = arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined
const browser = await chromium.launch({ executablePath })

/**
 * One page per frame, with its own tally of what the screen asked for. The theme comes from the `af_mode` cookie,
 * the same way a signed-in browser carries it.
 */
async function openFrame(routes, mode, viewport) {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport })
  await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
  const seen = { served: new Set(), unserved: new Set(), pending: 0 }
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    // Off-origin (headshots, crests, fonts from a CDN): a 404, so each image takes its own fallback.
    if (url.origin !== origin) return route.fulfill({ status: 404, body: '' })
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const hit = route.request().method() === 'GET' ? answer(routes, url) : undefined
    if (hit) {
      seen.served.add(url.pathname + (hit.query ? `?${new URLSearchParams(hit.query)}` : ''))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit.body) })
    }
    seen.unserved.add(`${route.request().method()} ${url.pathname}`)
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"harness"}' })
  })
  const page = await context.newPage()
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) seen.pending++ })
  const settle = (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) seen.pending-- }
  page.on('requestfinished', settle)
  page.on('requestfailed', settle)
  return { context, page, seen }
}

/** Wait until no /api/ read has been in flight for a second (not `networkidle`: `next dev` keeps an HMR socket open). */
async function apiQuiet(seen, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs
  let quietSince = null
  while (Date.now() < end) {
    if (seen.pending <= 0) {
      quietSince ??= Date.now()
      if (Date.now() - quietSince >= 1000) return true
    } else quietSince = null
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

async function readFrame(page) {
  return page.evaluate(() => ({
    htmlMode: document.documentElement.getAttribute('data-mode'),
    /*
     * `next dev` always mounts a <nextjs-portal> for its dev indicator, so its presence means nothing. An open
     * error dialog lives inside its shadow root; the toast beside it counts runtime issues without opening one.
     */
    errorOverlay: [...document.querySelectorAll('nextjs-portal')].some((el) => !!el.shadowRoot?.querySelector('[data-nextjs-dialog]')),
    devIssues: Number([...document.querySelectorAll('nextjs-portal')]
      .map((el) => [...(el.shadowRoot?.querySelectorAll('[data-nextjs-toast]') ?? [])].map((t) => t.textContent ?? '').join(' '))
      .join(' ')
      .match(/(\d+)\s*Issues?/i)?.[1] ?? 0),
    textLength: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().length,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    title: (document.querySelector('h1')?.textContent ?? '').trim().slice(0, 80),
  }))
}

function problemsFor(read, seen, routes, frame, status) {
  const p = []
  if (status !== 200) p.push(`page answered ${status}`)
  if (!read) return [...p, 'page could not be read']
  if (read.errorOverlay) p.push('Next.js error overlay is open')
  if (read.htmlMode !== HTML_MODE[frame.mode]) p.push(`html data-mode is ${read.htmlMode}, wanted ${HTML_MODE[frame.mode]}`)
  if (read.textLength < 80) p.push(`page has ${read.textLength} characters of text`)
  // A screen that asked for a fed path and was served none of it never saw its fixtures.
  const fedPaths = new Set(routes.map((r) => r.path))
  const askedFed = [...seen.unserved].some((u) => fedPaths.has(u.split(' ')[1]))
  if (askedFed && seen.served.size === 0) p.push('asked for fixture routes but none matched (query mismatch?)')
  return p
}

let shots = 0
let failures = 0
try {
  for (const harness of harnesses) {
    const { routes, frames } = HARNESSES[harness]
    const dir = path.join(out, harness)
    fs.mkdirSync(dir, { recursive: true })
    const report = []
    for (const f of frames) {
      if (frameFilter && !frameFilter.has(f.name)) continue
      for (const mode of modes) {
        for (const width of widths) {
          const viewport = WIDTHS[width]
          const name = `${f.name}-${mode}-${viewport.width}.jpg`
          let read = null
          let seen = null
          let status = 0
          let shot = false
          for (let attempt = 1; attempt <= 3 && !shot; attempt++) {
            const opened = await openFrame(routes, mode, viewport)
            seen = opened.seen
            try {
              const res = await opened.page.goto(`${baseUrl}${f.path}`, { waitUntil: 'load', timeout: 240_000 })
              status = res?.status() ?? 0
              await apiQuiet(seen)
              await opened.page.evaluate(() => document.fonts?.ready)
              read = await readFrame(opened.page)
              const problems = problemsFor(read, seen, routes, { ...f, mode }, status)
              // One re-read for a page caught mid-compile; a second refusal stands.
              if (problems.length && attempt < 2) continue
              if (problems.length) break
              // The dev indicator is not part of the screen under review.
              await opened.page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
              // JPEG: a full-page PNG per frame is several MB and these runs produce dozens.
              await opened.page.screenshot({ path: path.join(dir, name), fullPage: true, type: 'jpeg', quality: 72 })
              shot = true
            } catch (e) {
              console.error(`  retry ${attempt}: ${String(e.message).split('\n')[0]}`)
            } finally {
              await opened.context.close().catch(() => {})
            }
          }
          const problems = shot ? [] : problemsFor(read, seen ?? { served: new Set(), unserved: new Set() }, routes, { ...f, mode }, status)
          if (!shot && !problems.length) problems.push('could not shoot the frame')
          report.push({
            file: name, harness, frame: f.name, path: f.path, mode, width: viewport.width, status, ...read,
            served: [...(seen?.served ?? [])].sort(), unserved: [...(seen?.unserved ?? [])].sort(), problems,
          })
          if (problems.length) {
            failures++
            console.error(`✗ ${harness}/${name}: ${problems.join('; ')}`)
          } else {
            shots++
            console.log(`✓ ${harness}/${name}${seen.unserved.size ? `  (503: ${[...seen.unserved].join(', ')})` : ''}`)
          }
        }
      }
    }
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2))
  }
} finally {
  await browser.close().catch(() => {})
}
console.log(`${shots} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
