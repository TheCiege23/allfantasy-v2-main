#!/usr/bin/env node
/**
 * Screenshot every redraft identity surface for visual review:
 *   tab × width (1440, 390) × sport (the seven redraft-engine sports) × mode (light, dark[, af]).
 *
 *   node scripts/redraft-visual-capture.mjs --base-url http://localhost:3000 --out <dir>
 *     [--tabs native_home] [--modes light,dark,af] [--sports nfl,nba] [--chromium <path>]
 *
 * It renders /e2e/redraft-identity (DB-free: fixture props, no prisma call) against a `next dev`
 * you started yourself. Mode is set through the real `af_mode` cookie that app/layout.tsx reads.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. There is no default base URL, `allfantasy.ai` and its
 * subdomains are refused, and /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR. Before each screenshot it reads back
 * `<html data-mode>`, the workspace's `data-format`/`data-sport`, and the computed `--accent`; a
 * mismatch is an error, not a picture. A screenshot of the default look labelled "nba-light" is the
 * failure this guards against. Each frame's readings are written to report.json beside the PNGs.
 *
 * Adding a tab for a later phase: add an entry to TABS (its harness query) — nothing else changes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = {
  nfl: { sport: 'NFL', week: 9, total: 17, playoffs: 15, deadline: 12 },
  nba: { sport: 'NBA', week: 4, total: 21, playoffs: 19, deadline: 16 },
  nhl: { sport: 'NHL', week: 5, total: 22, playoffs: 20, deadline: 17 },
  mlb: { sport: 'MLB', week: 7, total: 26, playoffs: 24, deadline: 20 },
  ncaaf: { sport: 'NCAAF', week: 6, total: 15, playoffs: 13, deadline: 9 },
  ncaab: { sport: 'NCAAB', week: 8, total: 18, playoffs: 16, deadline: 12 },
  soccer: { sport: 'SOCCER', week: 11, total: 38, playoffs: 35, deadline: 26 },
}
/** tab id → the harness `tab` query. Only the foundation surfaces exist today. */
const TABS = { native_home: 'native_home' }
/** The DOM never says `af`: the AF theme renders as `<html data-mode="legacy">` (lib/theme/constants.ts). */
const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const list = (v, all) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : all)

const baseUrl = arg('base-url')
const out = arg('out')
if (!baseUrl || !out) {
  console.error('usage: --base-url <local dev server> --out <dir>  (no defaults on purpose)')
  process.exit(2)
}
const host = new URL(baseUrl).hostname
if (host === 'allfantasy.ai' || host.endsWith('.allfantasy.ai')) {
  console.error(`refusing ${host}: this harness never runs against production`)
  process.exit(2)
}
const modes = list(arg('modes'), ['light', 'dark'])
const sports = list(arg('sports'), Object.keys(SPORTS))
const tabs = list(arg('tabs'), Object.keys(TABS))
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const t of tabs) if (!TABS[t]) { console.error(`unknown tab ${t}`); process.exit(2) }

fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined })
const report = []
let failures = 0
try {
  for (const mode of modes) {
    const context = await browser.newContext({ deviceScaleFactor: 1 })
    await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
    const page = await context.newPage()
    for (const tab of tabs) {
      for (const sport of sports) {
        const s = SPORTS[sport]
        const q = new URLSearchParams({ sport: s.sport, phase: 'in_season', week: String(s.week), total: String(s.total), playoffs: String(s.playoffs), deadline: String(s.deadline), tab: TABS[tab] })
        for (const [label, viewport] of Object.entries(WIDTHS)) {
          await page.setViewportSize(viewport)
          // Not `networkidle`: `next dev` keeps an HMR socket and the page polls, so it never idles.
          await page.goto(`${baseUrl}/e2e/redraft-identity?${q}`, { waitUntil: 'load', timeout: 180_000 })
          const root = page.locator('[data-testid=native-league-workspace]')
          await root.waitFor({ state: 'visible', timeout: 60_000 })
          await page.evaluate(() => document.fonts?.ready)
          // The art is a CSS background; wait until the browser has actually fetched it.
          await page.waitForFunction(
            s => performance.getEntriesByType('resource').some(e => e.name.includes(`/artwork/redraft/${s}/`)),
            sport,
            { timeout: 30_000 },
          ).catch(() => {})
          const read = await page.evaluate(() => {
            const el = document.querySelector('[data-testid=native-league-workspace]')
            const cs = getComputedStyle(el)
            const active = document.querySelector(window.innerWidth < 768 ? '.nl-bottom-nav [aria-current=page]' : '.nl-nav-group button[aria-current=page]')
            return {
              htmlMode: document.documentElement.getAttribute('data-mode'),
              format: el.getAttribute('data-format'),
              sport: el.getAttribute('data-sport'),
              accent: cs.getPropertyValue('--accent').trim(),
              surface: cs.getPropertyValue('--surface').trim(),
              trackToken: cs.getPropertyValue('--rd-track').trim(),
              rdAccentText: cs.getPropertyValue('--rd-accent-text').trim(),
              activeNavColor: active ? getComputedStyle(active).color : null,
              mobileQuery: window.matchMedia('(max-width: 767px)').matches,
              track: document.querySelector('[data-testid=redraft-season-track] .nl-rd-track-head strong')?.textContent ?? null,
              chip: document.querySelector('[data-testid=redraft-season-chip]')?.textContent ?? null,
            }
          })
          const problems = []
          if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) problems.push(`html data-mode is ${read.htmlMode}, wanted ${HTML_MODE[mode] ?? mode}`)
          if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
          if (read.sport !== sport) problems.push(`data-sport is ${read.sport}`)
          if (!read.accent || read.accent !== read.rdAccentText) problems.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
          // /core's own palette must be live too, or the frame shows transparent chrome (measured once).
          if (!read.surface || !read.trackToken) problems.push(`/core palette missing (--surface "${read.surface}", --rd-track "${read.trackToken}")`)
          const file = `${tab}-${sport}-${mode}-${viewport.width}.png`
          report.push({ file, mode, sport, tab, width: viewport.width, ...read, problems })
          if (problems.length) {
            failures++
            console.error(`✗ ${file}: ${problems.join('; ')}`)
            continue
          }
          await page.screenshot({ path: path.join(out, file), fullPage: false })
          console.log(`✓ ${file}  accent=${read.accent}  nav=${read.activeNavColor}  mobileQuery=${read.mobileQuery}  ${read.track}`)
        }
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(`${report.length - failures} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
