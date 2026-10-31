#!/usr/bin/env node
/**
 * Screenshot the redraft League home batch (A1) for visual review:
 *   screen × sport (the seven redraft-engine sports) × mode (light, dark) × width (1440, 390).
 *
 *   node scripts/redraft-league-home-capture.mjs --base-url http://127.0.0.1:3000 --out <dir>
 *     [--screens home,home-predraft,football-home,draft] [--sports nfl,nba] [--modes light,dark]
 *     [--full-page] [--chromium <path>]
 *
 * It renders /e2e/redraft-league/<screen> (DB-free: the real components, a fetch stub answering the
 * endpoints they already read) against a `next dev` you started yourself. Separate from the
 * foundation's scripts/redraft-visual-capture.mjs, which shoots the workspace chrome harness and is
 * not this batch's to edit; the frame checks below are the same ones it makes.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL; `allfantasy.ai` and its subdomains are
 * refused; /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR: `<html data-mode>`, the workspace's
 * `data-format`/`data-sport` and the computed `--accent` are read back first, and the screen's own
 * root test id must be on the page. A mismatch is an error, not a picture. report.json records each.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = {
  nfl: { sport: 'NFL', week: 9 },
  nba: { sport: 'NBA', week: 4 },
  nhl: { sport: 'NHL', week: 5 },
  mlb: { sport: 'MLB', week: 7 },
  ncaaf: { sport: 'NCAAF', week: 6 },
  ncaab: { sport: 'NCAAB', week: 8 },
  soccer: { sport: 'SOCCER', week: 11 },
}
/** screen → harness route, query, and the test id that proves the screen itself rendered. */
const SCREENS = {
  home: { route: 'home', query: { phase: 'in_season', view: 'native_home' }, root: 'native-league-home' },
  'home-predraft': { route: 'home', query: { phase: 'pre_draft', view: 'native_home' }, root: 'native-league-home' },
  'football-home': { route: 'football-home', query: { phase: 'in_season', view: 'home' }, root: 'g32-nfl-redraft-home', sports: ['nfl', 'ncaaf'] },
  draft: { route: 'draft-hq', query: { phase: 'post_draft', view: 'draft' }, root: 'league-draftboard-card' },
}
const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } }
// --tall: the workspace scrolls inside its own pane, so --full-page cannot reach a card below the fold;
// a tall viewport shows the whole screen in one frame instead.
if (process.argv.includes('--tall')) {
  WIDTHS.desktop.height = 2200
  WIDTHS.phone.height = 2600
}

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
const host = new URL(baseUrl).hostname
if (host === 'allfantasy.ai' || host.endsWith('.allfantasy.ai')) {
  console.error(`refusing ${host}: this harness never runs against production`)
  process.exit(2)
}
const modes = list(arg('modes'), ['light', 'dark'])
const sports = list(arg('sports'), Object.keys(SPORTS))
const screens = list(arg('screens'), Object.keys(SCREENS))
const fullPage = process.argv.includes('--full-page')
const skipExisting = process.argv.includes('--skip-existing')
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const s of screens) if (!SCREENS[s]) { console.error(`unknown screen ${s}`); process.exit(2) }

fs.mkdirSync(out, { recursive: true })
// /dev/shm is small in containers; without this flag Chromium crashes the page mid-run.
const browser = await chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined, args: ['--disable-dev-shm-usage'] })
const report = []
let failures = 0
try {
  for (const mode of modes) {
    const context = await browser.newContext({ deviceScaleFactor: 1 })
    await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
    let page = await context.newPage()
    for (const screenKey of screens) {
      const screen = SCREENS[screenKey]
      for (const sport of sports) {
        if (screen.sports && !screen.sports.includes(sport)) continue
        const s = SPORTS[sport]
        const q = new URLSearchParams({ sport: s.sport, week: String(s.week), ...screen.query })
        for (const viewport of Object.values(WIDTHS)) {
          // --skip-existing resumes an interrupted run without re-shooting what is already on disk.
          if (skipExisting && fs.existsSync(path.join(out, `${screenKey}-${sport}-${mode}-${viewport.width}.png`))) continue
          // Watchdog: a hung renderer can stall an un-timed CDP call forever. Exit 3 instead, so a
          // wrapper can re-run with --skip-existing and pick up where this left off.
          clearTimeout(globalThis.__afFrameWatchdog)
          globalThis.__afFrameWatchdog = setTimeout(() => {
            console.error(`✗ watchdog: ${screenKey}-${sport}-${mode}-${viewport.width} stalled for 240s; exiting 3`)
            fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
            process.exit(3)
          }, 240_000)
          // A fresh page per frame: a crashed renderer would otherwise take every later frame with it.
          await page.close().catch(() => {})
          page = await context.newPage()
          await page.setViewportSize(viewport)
          const url = `${baseUrl}/e2e/redraft-league/${screen.route}?${q}`
          // A renderer crash (memory pressure on a shared box) is retried once on a fresh page, then
          // recorded as a refusal — never silently skipped, never a picture of a crashed tab.
          const loaded = await page.goto(url, { waitUntil: 'load', timeout: 180_000 }).then(() => true, async () => {
            await page.close().catch(() => {})
            page = await context.newPage()
            await page.setViewportSize(viewport)
            return page.goto(url, { waitUntil: 'load', timeout: 180_000 }).then(() => true, () => false)
          })
          if (!loaded) {
            failures++
            const file = `${screenKey}-${sport}-${mode}-${viewport.width}.png`
            report.push({ file, mode, sport, screen: screenKey, width: viewport.width, problems: ['page failed to load twice'] })
            console.error(`✗ ${file}: page failed to load twice`)
            continue
          }
          await page.locator('[data-testid=native-league-workspace]').waitFor({ state: 'visible', timeout: 60_000 })
          const rootFound = await page.locator(`[data-testid=${screen.root}]`).first().waitFor({ state: 'attached', timeout: 30_000 }).then(() => true, () => false)
          await Promise.race([page.evaluate(() => document.fonts?.ready), new Promise((r) => setTimeout(r, 15_000))]).catch(() => {})
          // The cards fill from the stubbed fetches; give them a beat to land.
          await page.waitForTimeout(1200)
          const read = await page.evaluate(() => {
            const el = document.querySelector('[data-testid=native-league-workspace]')
            const cs = getComputedStyle(el)
            return {
              htmlMode: document.documentElement.getAttribute('data-mode'),
              format: el.getAttribute('data-format'),
              sport: el.getAttribute('data-sport'),
              accent: cs.getPropertyValue('--accent').trim(),
              rdAccentText: cs.getPropertyValue('--rd-accent-text').trim(),
              surface: cs.getPropertyValue('--surface').trim(),
              mobileQuery: window.matchMedia('(max-width: 767px)').matches,
              pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
              testids: [...document.querySelectorAll('[data-testid^=redraft-]')].map((n) => n.getAttribute('data-testid')),
            }
          })
          const problems = []
          if (!rootFound) problems.push(`screen root [data-testid=${screen.root}] never rendered`)
          // Checked again at shot time: the workspace restores a remembered tab after mount, which once
          // swapped Draft HQ for League home AFTER the first check passed (every draft frame was home).
          else if ((await page.locator(`[data-testid=${screen.root}]`).count()) === 0) problems.push(`screen root [data-testid=${screen.root}] gone by shot time`)
          if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) problems.push(`html data-mode is ${read.htmlMode}, wanted ${HTML_MODE[mode] ?? mode}`)
          if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
          if (read.sport !== sport) problems.push(`data-sport is ${read.sport}`)
          if (!read.accent || read.accent !== read.rdAccentText) problems.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
          if (!read.surface) problems.push('/core palette missing (--surface empty)')
          const file = `${screenKey}-${sport}-${mode}-${viewport.width}.png`
          report.push({ file, mode, sport, screen: screenKey, width: viewport.width, ...read, problems })
          if (problems.length) {
            failures++
            console.error(`✗ ${file}: ${problems.join('; ')}`)
            continue
          }
          // Bounded: a screenshot that never returns once hung a whole run on a memory-starved box.
          const shot = await Promise.race([
            page.screenshot({ path: path.join(out, file), fullPage, timeout: 60_000 }).then(() => true, () => false),
            new Promise((r) => setTimeout(() => r(false), 90_000)),
          ])
          if (!shot) {
            failures++
            report.at(-1).problems.push('screenshot did not complete')
            console.error(`✗ ${file}: screenshot did not complete`)
            continue
          }
          console.log(`✓ ${file}  accent=${read.accent}  sideways=${read.pageScrollsSideways}  ${read.testids.join(',')}`)
        }
      }
    }
    await context.close()
  }
} finally {
  clearTimeout(globalThis.__afFrameWatchdog)
  await browser.close()
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(`${report.length - failures} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
