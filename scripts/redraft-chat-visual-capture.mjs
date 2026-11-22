#!/usr/bin/env node
/**
 * Screenshot the redraft League chat for visual review: sport × mode (light, dark) × width (1440, 390).
 *
 *   node scripts/redraft-chat-visual-capture.mjs --base-url http://localhost:3000 --out <dir>
 *     [--modes light,dark] [--sports nfl,nba] [--chromium <path>]
 *
 * Renders /e2e/redraft-league/chat (DB-free: fixture network, see redraftChatFixture.ts) against a
 * `next dev` you started yourself. Mode is the real `af_mode` cookie app/layout.tsx reads.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL, `allfantasy.ai` and its subdomains are
 * refused, and /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES A FRAME IT CANNOT VOUCH FOR: `<html data-mode>`, the workspace's `data-format` /
 * `data-sport`, and the fixture transcript having actually loaded (the viewer's own row is on screen)
 * are read back before each shot. A screenshot of "Loading chat…" labelled nba-light is the failure
 * this guards against. Each frame's readings — including the own bubble's computed background and the
 * number of event cards — go to report.json beside the PNGs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
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
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }

fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined })
const report = []
let failures = 0
/** One frame: navigate, verify, shoot. Throws on a browser-level failure so the caller can retry. */
async function shoot(page, mode, sport, viewport) {
  await page.setViewportSize(viewport)
  // Not `networkidle`: `next dev` keeps an HMR socket and the chat polls, so it never idles.
  await page.goto(`${baseUrl}/e2e/redraft-league/chat?sport=${SPORTS[sport]}`, { waitUntil: 'load', timeout: 180_000 })
  await page.locator('[data-testid=native-league-workspace]').waitFor({ state: 'visible', timeout: 60_000 })
  const loaded = await page.locator('[data-message-id=fx-own]').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(
    s => performance.getEntriesByType('resource').some(e => e.name.includes(`/artwork/redraft/${s}/`)),
    sport,
    { timeout: 15_000 },
  ).catch(() => {})
  // The list pins itself to the newest row; give the scroller a frame to settle.
  await page.waitForTimeout(400)
  const read = await page.evaluate(() => {
    const root = document.querySelector('[data-testid=native-league-workspace]')
    const own = document.querySelector('[data-message-id=fx-own] .af-cm-bubble')
    const convo = document.querySelector('[data-testid=league-chat-conversation]')
    return {
      htmlMode: document.documentElement.getAttribute('data-mode'),
      format: root?.getAttribute('data-format') ?? null,
      sport: root?.getAttribute('data-sport') ?? null,
      rdAccent: root ? getComputedStyle(root).getPropertyValue('--rd-accent').trim() : null,
      ownBubbleBg: own ? getComputedStyle(own).backgroundColor : null,
      ownBubbleColor: own ? getComputedStyle(own).color : null,
      convoBackgroundImage: convo ? getComputedStyle(convo).backgroundImage.slice(0, 120) : null,
      eventCards: document.querySelectorAll('[data-rd-event]').length,
      systemRows: document.querySelectorAll('.af-cm-row-system').length,
      pinnedScore: document.querySelector('[data-testid=redraft-chat-pinned-score]')?.textContent ?? null,
    }
  })
  const problems = []
  if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) problems.push(`html data-mode is ${read.htmlMode}, wanted ${HTML_MODE[mode] ?? mode}`)
  if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
  if (read.sport !== sport) problems.push(`data-sport is ${read.sport}`)
  if (!loaded) problems.push('fixture transcript never rendered (no fx-own row)')
  const file = `chat-${sport}-${mode}-${viewport.width}.png`
  if (!problems.length) {
    // The workspace scrolls inside its own column, so a full-page shot stops at the fold. Bring the
    // panel to the top, shoot the newest messages (the list pins itself to the bottom), then scroll
    // the conversation to its oldest row and shoot again — every fixture event is in one of the two.
    await page.evaluate(() => document.querySelector('[data-testid=league-chat-panel]')?.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(out, file.replace('.png', '-latest.png')) })
    await page.evaluate(() => { const t = document.querySelector('[data-testid=league-chat-conversation] .af-cm-thread'); if (t) t.scrollTop = 0 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(out, file.replace('.png', '-oldest.png')) })
  }
  return { file, read, problems }
}

try {
  for (const mode of modes) {
    const context = await browser.newContext({ deviceScaleFactor: 1 })
    await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
    let page = await context.newPage()
    for (const sport of sports) {
      for (const viewport of Object.values(WIDTHS)) {
        // `next dev` can abort a navigation while it recompiles, and a busy box can crash a tab:
        // retry the frame on a fresh page rather than lose the run.
        let result
        for (let attempt = 1; ; attempt++) {
          try {
            result = await shoot(page, mode, sport, viewport)
            break
          } catch (e) {
            if (attempt >= 3) throw e
            console.error(`… retrying ${sport}/${mode}/${viewport.width}: ${String(e?.message ?? e).split('\n')[0]}`)
            await page.close().catch(() => {})
            page = await context.newPage()
          }
        }
        const { file, read, problems } = result
        report.push({ file, mode, sport, width: viewport.width, ...read, problems })
        if (problems.length) {
          failures++
          console.error(`✗ ${file}: ${problems.join('; ')}`)
          continue
        }
        console.log(`✓ ${file}  own=${read.ownBubbleBg}  events=${read.eventCards}  pinned=${read.pinnedScore ?? '-'}`)
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
