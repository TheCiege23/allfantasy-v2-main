#!/usr/bin/env node
/**
 * Screenshot the /core Standings, Season Outlook, Commissioner and Brackets screens with a native redraft
 * league open (batch B6), for visual review:
 *   screen × sport (the seven redraft-engine sports) × mode (light, dark) × width (1440, 390).
 *
 *   node scripts/redraft-core-standings-capture.mjs --base-url http://127.0.0.1:3646 --out <dir> --state after
 *     [--screens standings,commissioner] [--sports nfl,nba] [--modes light,dark] [--full [--max-height 2600]] [--skip-existing] [--chromium <path>]
 *
 * Renders /e2e/redraft-core/standings/<screen> (real AfCoreShell + the real screen on fixture data)
 * against a `next dev` you started yourself — with the database pinned to an unreachable sentinel, because
 * the Commissioner screen's streamed reports call prisma and only catch the failure:
 *
 *   DATABASE_URL=postgresql://u:p@127.0.0.1:1/none DIRECT_URL=$DATABASE_URL node node_modules/next/dist/bin/next dev -p 3646
 *
 * Frames land in <out>/<screen>/<state>/<screen>-<sport>-<mode>-<width>.png, plus report.json.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL, `allfantasy.ai` and its subdomains are
 * refused, and /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR. Every frame must read back the html mode it claims,
 * the stamp (`data-format=redraft`, the right `data-sport`, `--accent` = the sport's `--rd-accent-text`),
 * and the screen's own root (`.af-st`, `.af-sol`, `.af-ch`, `.af-bk`) — a harness that rendered an error
 * page would otherwise produce a tidy set of pictures of nothing. Each mode also shoots one dynasty
 * control that must carry NO stamp.
 *
 * ⚠ "BEFORE" IS A GIT STATE, NOT A FLAG. The B6 rules ship inside the screens' own stylesheet imports, so
 * there is no query parameter that switches them off. Shoot `--state before` on the commit the batch is
 * built on (the harness files copied in), and `--state after` on the batch.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
const SCREENS = { standings: '.af-st', 'season-outlook': '.af-sol', commissioner: '.af-ch', bracket: '.af-bk' }
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const list = (v, all) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : all)

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
const screens = list(arg('screens'), Object.keys(SCREENS))
const fullPage = process.argv.includes('--full')
/** Full-page frames are clipped to this height: a whole Standings page at 1440 is ~3,500px and crashed the renderer. */
const maxHeight = Number(arg('max-height', '2600'))
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const s of screens) if (!SCREENS[s]) { console.error(`unknown screen ${s}`); process.exit(2) }

async function readFrame(page, rootSel) {
  return page.evaluate((sel) => {
    const el = document.querySelector('.af-core.af-shell')
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      htmlMode: document.documentElement.getAttribute('data-mode'),
      format: el.getAttribute('data-format'),
      sport: el.getAttribute('data-sport'),
      accent: cs.getPropertyValue('--accent').trim(),
      rdAccentText: cs.getPropertyValue('--rd-accent-text').trim(),
      screenRoot: Boolean(document.querySelector(sel)),
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  }, rootSel)
}

/** A crashed renderer takes its page with it, so every attempt gets a fresh page (returned to the caller). */
async function goto(context, viewport, url, rootSel) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const page = await context.newPage()
    try {
      await page.setViewportSize(viewport)
      // Not `networkidle`: `next dev` keeps an HMR socket open, so it never idles.
      await page.goto(url, { waitUntil: 'load', timeout: 240_000 })
      await page.locator(rootSel).first().waitFor({ state: 'visible', timeout: 90_000 })
      return page
    } catch (err) {
      await page.close().catch(() => {})
      if (attempt === 3) throw err
      console.error(`  retry ${attempt} for ${url}: ${String(err).split('\n')[0]}`)
      await new Promise((r) => setTimeout(r, 4000))
    }
  }
}

const launch = () =>
  chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined, args: ['--disable-gpu'] })
let browser = await launch()
/** `--skip-existing` resumes an interrupted run: a frame already on disk is not shot again. */
const skipExisting = process.argv.includes('--skip-existing')
const report = []
let failures = 0
try {
  for (const mode of modes) {
    const freshContext = async () => {
      // A renderer crash under memory pressure can take the whole browser with it; relaunch rather than
      // refusing every remaining frame with "browser has been closed".
      if (!browser.isConnected()) browser = await launch()
      const c = await browser.newContext({ deviceScaleFactor: 1 })
      await c.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
      return c
    }
    let context = await freshContext()
    const frames = []
    for (const screen of screens) for (const sport of sports) frames.push({ screen, sport, leagueType: 'redraft' })
    frames.push({ screen: screens[0], sport: 'nfl', leagueType: 'dynasty', control: true })
    for (const f of frames) {
      const rootSel = SCREENS[f.screen]
      const dir = path.join(out, f.screen, state)
      fs.mkdirSync(dir, { recursive: true })
      const q = new URLSearchParams({ sport: SPORTS[f.sport], leagueType: f.leagueType })
      for (const [, viewport] of Object.entries(WIDTHS)) {
        const file = `${f.control ? 'control-dynasty' : f.screen}-${f.sport}-${mode}-${viewport.width}.png`
        if (skipExisting && fs.existsSync(path.join(dir, file))) continue
        if (!browser.isConnected()) context = await freshContext()
        let read = null
        let page = null
        const problems = []
        try {
          page = await goto(context, viewport, `${baseUrl}/e2e/redraft-core/standings/${f.screen}?${q}`, rootSel)
          await page.evaluate(() => document.fonts?.ready)
          await page.waitForTimeout(400)
          read = await readFrame(page, rootSel)
        } catch (err) {
          problems.push(`did not render: ${String(err).split('\n')[0]}`)
        }
        if (!problems.length) {
          if (!read) problems.push('no .af-core.af-shell root')
          else {
            if (read.htmlMode !== mode) problems.push(`html data-mode is ${read.htmlMode}`)
            if (!read.screenRoot) problems.push(`screen root ${rootSel} missing`)
            if (!f.control) {
              if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
              if (read.sport !== f.sport) problems.push(`data-sport is ${read.sport}`)
              if (!read.accent || read.accent !== read.rdAccentText) problems.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
            } else if (read.format || read.sport) {
              problems.push(`control must carry no stamp, got data-format=${read.format} data-sport=${read.sport}`)
            }
          }
        }
        report.push({ file, state, mode, ...f, width: viewport.width, ...read, problems })
        if (problems.length) {
          failures++
          console.error(`✗ ${f.screen}/${file}: ${problems.join('; ')}`)
          await page?.close().catch(() => {})
          continue
        }
        const height = fullPage ? Math.min(maxHeight, await page.evaluate(() => document.documentElement.scrollHeight)) : viewport.height
        await page.screenshot({ path: path.join(dir, file), fullPage, clip: { x: 0, y: 0, width: viewport.width, height } })
        // The health panel sits ~5,000px down the Commissioner page, below any clip; shoot it on its own.
        if (f.screen === 'commissioner' && !f.control) {
          const health = page.locator('#ch-health').first()
          if (await health.count()) await health.screenshot({ path: path.join(dir, file.replace('.png', '-health.png')) }).catch(() => {})
        }
        await page.close().catch(() => {})
        console.log(`✓ ${f.screen}/${state}/${file}  accent=${read.accent}  overflowX=${read.pageOverflowX}`)
      }
    }
    await context.close().catch(() => {})
  }
} finally {
  await browser.close()
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, `report-${state}.json`), JSON.stringify(report, null, 2))
}
console.log(`${report.length - failures} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
