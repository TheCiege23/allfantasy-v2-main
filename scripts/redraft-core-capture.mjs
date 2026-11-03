#!/usr/bin/env node
/**
 * Screenshot the /core shell with a native redraft league open, for visual review:
 *   screen × width (1440, 390) × sport (the seven redraft-engine sports) × mode (light, dark[, af]).
 *
 *   node scripts/redraft-core-capture.mjs --base-url http://localhost:3000 --out <dir> --state after
 *     [--state before] [--screens my-team,matchup] [--modes light,dark,af] [--sports nfl,nba] [--chromium <path>]
 *
 * Renders /e2e/redraft-core/shell (DB-free, real AfCoreShell, fixture body) against a `next dev` you
 * started yourself. `--state before` adds `identity=off`, which renders the shell exactly as it was
 * before the stamp (the stamp prop absent), so a before/after pair differs only by the stamp.
 * The foundation's scripts/redraft-visual-capture.mjs (the /league workspace) is left untouched.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL, `allfantasy.ai` and its subdomains are
 * refused, and /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR — in both directions. `after` must read back
 * `data-format=redraft`, the right `data-sport`, and `--accent` equal to the sport's `--rd-accent-text`;
 * `before` must read back NO stamp. And every mode also shoots one control frame (a dynasty league on
 * the same harness) that must carry no stamp — a harness that stamps everything would otherwise produce
 * a perfect "after" set. Readings go to report.json beside the PNGs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
const SCREENS = ['my-team', 'matchup', 'waivers', 'trades', 'players', 'draft-hq', 'week', 'season-outlook']
const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const list = (v, all) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : all)

const baseUrl = arg('base-url')
const out = arg('out')
const state = arg('state')
if (!baseUrl || !out || !['before', 'after'].includes(state)) {
  console.error('usage: --base-url <local dev server> --out <dir> --state before|after  (no defaults on purpose)')
  process.exit(2)
}
const host = new URL(baseUrl).hostname
if (host === 'allfantasy.ai' || host.endsWith('.allfantasy.ai')) {
  console.error(`refusing ${host}: this harness never runs against production`)
  process.exit(2)
}
const modes = list(arg('modes'), ['light', 'dark'])
const sports = list(arg('sports'), Object.keys(SPORTS))
const screens = list(arg('screens'), ['my-team'])
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const s of screens) if (!SCREENS.includes(s)) { console.error(`unknown screen ${s}`); process.exit(2) }

async function readFrame(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.af-core.af-shell')
    if (!el) return null
    const cs = getComputedStyle(el)
    const active = document.querySelector(window.innerWidth <= 720 ? '.af-tabbar-item[data-active=true]' : '.af-nav-item[data-active=true]')
    return {
      htmlMode: document.documentElement.getAttribute('data-mode'),
      format: el.getAttribute('data-format'),
      sport: el.getAttribute('data-sport'),
      accent: cs.getPropertyValue('--accent').trim(),
      rdAccentText: cs.getPropertyValue('--rd-accent-text').trim(),
      surface: cs.getPropertyValue('--surface').trim(),
      activeNavColor: active ? getComputedStyle(active).color : null,
      topbarBorder: getComputedStyle(document.querySelector('.af-topbar') ?? el).borderBottomColor,
    }
  })
}

fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined })
const report = []
let failures = 0
try {
  for (const mode of modes) {
    const context = await browser.newContext({ deviceScaleFactor: 1 })
    await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
    const page = await context.newPage()
    const frames = []
    for (const screen of screens) for (const sport of sports) frames.push({ screen, sport, leagueType: 'redraft' })
    frames.push({ screen: screens[0], sport: 'nfl', leagueType: 'dynasty', control: true })
    for (const f of frames) {
      const q = new URLSearchParams({ sport: SPORTS[f.sport], screen: f.screen, leagueType: f.leagueType })
      if (state === 'before') q.set('identity', 'off')
      for (const [, viewport] of Object.entries(WIDTHS)) {
        await page.setViewportSize(viewport)
        // Not `networkidle`: `next dev` keeps an HMR socket open, so it never idles.
        await page.goto(`${baseUrl}/e2e/redraft-core/shell?${q}`, { waitUntil: 'load', timeout: 180_000 })
        await page.locator('[data-testid=redraft-core-fixture]').waitFor({ state: 'visible', timeout: 60_000 })
        await page.evaluate(() => document.fonts?.ready)
        const read = await readFrame(page)
        const problems = []
        const stamped = state === 'after' && !f.control
        if (!read) problems.push('no .af-core.af-shell root')
        else {
          if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) problems.push(`html data-mode is ${read.htmlMode}`)
          if (!read.surface) problems.push('/core palette missing (--surface empty)')
          if (stamped) {
            if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
            if (read.sport !== f.sport) problems.push(`data-sport is ${read.sport}`)
            if (!read.accent || read.accent !== read.rdAccentText) problems.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
          } else if (read.format || read.sport) {
            problems.push(`expected no stamp, got data-format=${read.format} data-sport=${read.sport}`)
          }
        }
        const file = `${f.control ? 'control-dynasty' : f.screen}-${f.sport}-${mode}-${viewport.width}.png`
        report.push({ file, state, mode, ...f, width: viewport.width, ...read, problems })
        if (problems.length) {
          failures++
          console.error(`✗ ${file}: ${problems.join('; ')}`)
          continue
        }
        await page.screenshot({ path: path.join(out, file), fullPage: false })
        console.log(`✓ ${file}  accent=${read.accent}  nav=${read.activeNavColor}  topbar=${read.topbarBorder}`)
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
