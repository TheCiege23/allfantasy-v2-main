#!/usr/bin/env node
/**
 * Screenshot the /core Trades and War Room screens (batch B4 of the redraft visual upgrade):
 *   screen (trades, war-room) × sport (the seven redraft-engine sports) × mode (light, dark) × width (1440, 390).
 *
 *   node scripts/redraft-core-trades-capture.mjs --base-url http://localhost:3104 --out <dir> --state before|after
 *     [--screens trades,war-room] [--modes light,dark] [--sports nfl,nba] [--extras] [--resume] [--chromium <path>]
 *
 * Renders /e2e/redraft-core/trades/<screen> (real AfCoreShell + the real TradeCenter / Trades / Scout /
 * ConnectedFranchiseWarRoom components on fixture props) against a `next dev` you started yourself.
 * `before` is shot on a tree WITHOUT the B4 stylesheet and `after` on one with it — the harness is the
 * same either way, so the pair differs only by the batch. `--extras` adds the deadline states
 * (final / passed / none / scheduled / unknown) and the franchise room, NFL only.
 *
 * 🛑 DB-FREE BY INTERCEPTION, NOT BY HOPE. Every `/api/*` request the page makes is answered here
 * (`page.route`): the Trade Center's roster and trades-panel reads from
 * app/e2e/redraft-core/trades/trades-api-fixture.json, everything else with an empty 404. No request
 * reaches a route handler, so none can reach a database — whatever `.env` the dev server happens to read.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL; `allfantasy.ai` and its subdomains are refused.
 *
 * ⚠ IT REFUSES A FRAME IT CANNOT VOUCH FOR, IN BOTH DIRECTIONS. A redraft frame must read back the stamp,
 * the right sport and `--accent` = `--rd-accent-text`; in `after` it must ALSO read `--rd-b4: on` (set
 * only by af-core-redraft-trades.css under the redraft root), and in `before` it must not. Each mode
 * shoots a dynasty control frame that must carry no stamp and no `--rd-b4` — a stylesheet that leaked
 * past its scope would otherwise produce a perfect "after" set.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
const SCREENS = ['trades', 'war-room']
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } }
const EXTRAS = [
  { screen: 'trades', deadline: 'final' },
  { screen: 'trades', deadline: 'passed' },
  { screen: 'trades', deadline: 'none' },
  { screen: 'trades', deadline: 'scheduled' },
  { screen: 'trades', deadline: 'unknown' },
  { screen: 'war-room', franchise: true },
]

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
const screens = list(arg('screens'), SCREENS)
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const s of screens) if (!SCREENS.includes(s)) { console.error(`unknown screen ${s}`); process.exit(2) }

const apiFixture = JSON.parse(fs.readFileSync(new URL('../app/e2e/redraft-core/trades/trades-api-fixture.json', import.meta.url), 'utf8'))

/** page.evaluate has no timeout of its own; a starved renderer can leave it pending forever. */
function withTimeout(promise, ms, what) {
  let t
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms) })]).finally(() => clearTimeout(t))
}

async function answerApi(route) {
  const url = new URL(route.request().url())
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (/\/api\/leagues\/[^/]+\/trades\/rosters$/.test(url.pathname)) return json(200, apiFixture.rosters)
  if (url.pathname === '/api/league/trades-panel') return json(200, apiFixture.panel)
  return json(404, {})
}

async function readFrame(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.af-core.af-shell')
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      htmlMode: document.documentElement.getAttribute('data-mode'),
      format: el.getAttribute('data-format'),
      sport: el.getAttribute('data-sport'),
      accent: cs.getPropertyValue('--accent').trim(),
      rdAccentText: cs.getPropertyValue('--rd-accent-text').trim(),
      b4: cs.getPropertyValue('--rd-b4').trim(),
      surface: cs.getPropertyValue('--surface').trim(),
      deadlineBar: document.querySelector('[data-testid=rd-trade-deadline]')?.getAttribute('data-state') ?? null,
      scrollWidth: document.documentElement.scrollWidth,
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
    await context.route('**/api/**', answerApi)
    let page = await context.newPage()
    // A shared box runs out of memory and Chromium kills the tab ("Target crashed"). A crashed page
    // is replaced rather than ending the run; the frame is retried on the fresh page.
    const freshPage = async () => {
      await page.close().catch(() => {})
      page = await context.newPage()
    }
    const frames = []
    for (const screen of screens) for (const sport of sports) frames.push({ screen, sport, leagueType: 'redraft' })
    if (process.argv.includes('--extras')) for (const x of EXTRAS) if (screens.includes(x.screen)) frames.push({ ...x, sport: 'nfl', leagueType: 'redraft' })
    for (const screen of screens) frames.push({ screen, sport: 'nfl', leagueType: 'dynasty', control: true })
    for (const f of frames) {
      const q = new URLSearchParams({ sport: SPORTS[f.sport], leagueType: f.leagueType })
      if (f.deadline) q.set('deadline', f.deadline)
      if (f.franchise) q.set('franchise', '1')
      for (const [, viewport] of Object.entries(WIDTHS)) {
        const tag0 = f.control ? 'control-dynasty' : f.deadline ? `deadline-${f.deadline}` : f.franchise ? 'franchise' : f.sport
        // --resume: a long run on a shared box gets interrupted; keep the frames already shot.
        if (process.argv.includes('--resume') && fs.existsSync(path.join(out, `${f.screen}-${tag0}-${mode}-${viewport.width}.png`))) continue
        let read = null
        for (let attempt = 0; attempt < 4 && !read; attempt++) {
          try {
            if (attempt > 0) await freshPage()
            await page.setViewportSize(viewport)
            // Not `networkidle`: `next dev` keeps an HMR socket open, so it never idles.
            await page.goto(`${baseUrl}/e2e/redraft-core/trades/${f.screen}?${q}`, { waitUntil: 'load', timeout: 240_000 })
            await page.locator('[data-testid=redraft-core-trades-fixture]').waitFor({ state: 'visible', timeout: 90_000 })
            await withTimeout(page.evaluate(() => document.fonts?.ready), 20_000, 'fonts')
            await page.waitForTimeout(f.screen === 'trades' ? 1500 : 400)
            read = await withTimeout(readFrame(page), 20_000, 'read')
          } catch (e) {
            console.error(`  retry ${attempt + 1}: ${e.message.split('\n')[0]}`)
          }
        }
        const problems = []
        const stamped = !f.control
        if (!read) problems.push('no .af-core.af-shell root')
        else {
          if (read.htmlMode !== mode) problems.push(`html data-mode is ${read.htmlMode}`)
          if (!read.surface) problems.push('/core palette missing (--surface empty)')
          if (stamped) {
            if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
            if (read.sport !== f.sport) problems.push(`data-sport is ${read.sport}`)
            if (!read.accent || read.accent !== read.rdAccentText) problems.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
            if (state === 'after' && read.b4 !== 'on') problems.push(`--rd-b4 is "${read.b4}" — the B4 stylesheet did not apply`)
            if (state === 'before' && read.b4) problems.push(`--rd-b4 is "${read.b4}" on a before frame`)
          } else {
            if (read.format || read.sport) problems.push(`expected no stamp, got data-format=${read.format} data-sport=${read.sport}`)
            if (read.b4) problems.push(`--rd-b4 leaked onto a non-redraft frame`)
            if (read.deadlineBar) problems.push(`redraft deadline bar rendered on a non-redraft frame`)
          }
          if (read.scrollWidth > viewport.width + 1) problems.push(`horizontal scroll: ${read.scrollWidth}px at ${viewport.width}`)
        }
        const tag = f.control ? 'control-dynasty' : f.deadline ? `deadline-${f.deadline}` : f.franchise ? 'franchise' : f.sport
        const file = `${f.screen}-${tag}-${mode}-${viewport.width}.png`
        report.push({ file, state, mode, ...f, width: viewport.width, ...read, problems })
        if (problems.length) {
          failures++
          console.error(`✗ ${file}: ${problems.join('; ')}`)
          // Still shoot it: a refused frame is evidence, filed under refused/.
          fs.mkdirSync(path.join(out, 'refused'), { recursive: true })
          await page.screenshot({ path: path.join(out, 'refused', file), fullPage: true }).catch(() => {})
          continue
        }
        try {
          await withTimeout(page.screenshot({ path: path.join(out, file), fullPage: true, timeout: 60_000 }), 90_000, 'screenshot')
        } catch (e) {
          failures++
          console.error(`✗ ${file}: screenshot failed — ${e.message.split('\n')[0]}`)
          await freshPage()
          continue
        }
        console.log(`✓ ${file}  accent=${read.accent}  b4=${read.b4 || '-'}  deadline=${read.deadlineBar ?? '-'}`)
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
  fs.writeFileSync(path.join(out, process.argv.includes('--resume') ? `report-${Date.now()}.json` : 'report.json'), JSON.stringify(report, null, 2))
}
console.log(`${report.length - failures} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
