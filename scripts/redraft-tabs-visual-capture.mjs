#!/usr/bin/env node
/**
 * Screenshot the four Tailwind tabs of batch A6 (War Room, Live scores, Chimmy Coaching, Schedule):
 *   tab × sport (the seven redraft-engine sports) × mode (light, dark) × width (1440, 390),
 *   plus a dynasty and a guillotine CONTROL league per tab (NFL, light + dark, both widths), which must
 *   NOT carry the redraft identity.
 *
 *   node scripts/redraft-tabs-visual-capture.mjs --base-url http://localhost:3217 --out <dir>
 *     [--phase before|after] [--tabs scores,schedule] [--sports nfl,nba] [--modes light,dark] [--no-controls]
 *     [--chromium <path>]
 *
 * Writes <out>/<tab>/<phase>/<sport>-<mode>-<width>.png and …/control-<format>-<mode>-<width>.png
 * (no <phase> level when --phase is omitted),
 * plus <out>/report.json. Renders /e2e/redraft-league/<tab> (DB-free: fixtures answered in the browser,
 * app/e2e/redraft-league/fixtures.ts) against a `next dev` you started yourself; mode is the real
 * `af_mode` cookie app/layout.tsx reads.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY: no default base URL, `allfantasy.ai` and its subdomains are
 * refused, and /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR: `<html data-mode>`, the workspace's
 * `data-format` / `data-sport`, and the tab's own root testid are read back before each shot. A
 * redraft frame must carry the identity; a control frame must not. A mismatch is an error, not a
 * picture.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
/** tab → [root testid, a testid that appears once the tab's data has rendered]. */
const TABS = {
  war_room: ['league-war-room-tab', 'redraft-war-room-panel'],
  scores: ['scores-game-center', 'scores-games-list'],
  ai_coaching: ['ai-coaching-hero', 'ai-coaching-hero'],
  schedule: ['canonical-redraft-schedule-tab', 'redraft-schedule-view'],
}
const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]

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
const controls = !process.argv.includes('--no-controls')
const phase = arg('phase', '')
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const t of tabs) if (!TABS[t]) { console.error(`unknown tab ${t}`); process.exit(2) }

const frames = []
for (const tab of tabs) {
  for (const mode of modes) {
    for (const sport of sports) frames.push({ tab, mode, sport, format: 'redraft' })
    if (controls) for (const format of ['dynasty', 'guillotine']) frames.push({ tab, mode, sport: 'nfl', format })
  }
}

const launch = () => chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined })
let browser = await launch()
const report = []
let failures = 0
try {
  for (const mode of modes) {
    const newContext = async () => {
      const c = await browser.newContext({ deviceScaleFactor: 1 })
      await c.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
      return c
    }
    let context = await newContext()
    let page = await context.newPage()
    for (const f of frames.filter(x => x.mode === mode)) {
      const [rootId, redraftReadyId] = TABS[f.tab]
      // The redraft War Room panel is mounted for redraft leagues only, so a control waits on the root.
      const readyId = f.format === 'redraft' ? redraftReadyId : rootId
      const dir = path.join(f.tab, phase)
      fs.mkdirSync(path.join(out, dir), { recursive: true })
      for (const viewport of WIDTHS) {
       // A renderer can be OOM-killed on a contended box ("Target crashed"); a crash is retried on a
       // fresh page, never turned into a picture.
       for (let attempt = 1; ; attempt++) {
        try {
        // A fresh browser per frame: one renderer navigated many times under `next dev` grows until
        // it is killed ("Page crashed"), and a fresh page in the same browser was not enough.
        await context.close().catch(() => {})
        await browser.close().catch(() => {})
        browser = await launch()
        context = await newContext()
        page = await context.newPage()
        await page.setViewportSize(viewport)
        const q = new URLSearchParams({ sport: SPORTS[f.sport], format: f.format })
        // Not `networkidle`: `next dev` keeps an HMR socket open, so it never idles.
        await page.goto(`${baseUrl}/e2e/redraft-league/${f.tab}?${q}`, { waitUntil: 'load', timeout: 180_000 })
        await page.locator('[data-testid=native-league-workspace]').waitFor({ state: 'visible', timeout: 90_000 })
        const ready = await page.locator(`[data-testid=${readyId}]`).first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)
        await page.evaluate(() => document.fonts?.ready)
        await page.waitForTimeout(400)
        const read = await page.evaluate(rid => {
          const el = document.querySelector('[data-testid=native-league-workspace]')
          return {
            htmlMode: document.documentElement.getAttribute('data-mode'),
            format: el?.getAttribute('data-format') ?? null,
            sport: el?.getAttribute('data-sport') ?? null,
            tabRoot: Boolean(document.querySelector(`[data-testid=${rid}]`)),
            rdAccent: el ? getComputedStyle(el).getPropertyValue('--rd-accent').trim() : '',
          }
        }, rootId)
        const problems = []
        if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) problems.push(`html data-mode is ${read.htmlMode}, wanted ${HTML_MODE[mode] ?? mode}`)
        if (!read.tabRoot) problems.push(`tab root [data-testid=${rootId}] not rendered`)
        if (f.format === 'redraft') {
          if (read.format !== 'redraft') problems.push(`data-format is ${read.format}, wanted redraft`)
          if (read.sport !== f.sport) problems.push(`data-sport is ${read.sport}, wanted ${f.sport}`)
          if (!read.rdAccent) problems.push('--rd-accent is empty on a redraft frame')
        } else {
          if (read.format === 'redraft' || read.rdAccent) problems.push(`control ${f.format} league carries the redraft identity (${read.format}, ${read.rdAccent})`)
        }
        const name = f.format === 'redraft' ? `${f.sport}-${mode}-${viewport.width}.png` : `control-${f.format}-${mode}-${viewport.width}.png`
        const file = path.join(dir, name)
        report.push({ file, ...f, width: viewport.width, ready, ...read, problems })
        if (problems.length) {
          failures++
          console.error(`✗ ${file}: ${problems.join('; ')}`)
          break
        }
        await page.screenshot({ path: path.join(out, file), fullPage: false })
        console.log(`✓ ${file}${ready ? '' : '  (data testid not seen — tab shows its empty/loading state)'}`)
        break
        } catch (e) {
          if (attempt >= 4) throw e
          console.error(`  retry ${attempt} (${String(e.message).split('\n')[0]})`)
          await new Promise(r => setTimeout(r, 5000))
        }
       }
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(`${report.length - failures} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
