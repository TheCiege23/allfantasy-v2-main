#!/usr/bin/env node
/**
 * Screenshot the redraft broadcast deck (batch A3) for visual review:
 *   tab (decide, draft_intel, legacy, commissioner) × sport (7) × mode (light, dark[, af]) × width (1440, 390).
 *
 *   node scripts/redraft-deck-capture.mjs --base-url http://localhost:3000 --out <dir>
 *     [--tabs commissioner] [--sports nfl,nba] [--modes light,dark] [--state season|empty]
 *     [--phase before|after] [--expect-deck] [--skip-existing] [--chromium <path>]
 *
 * Renders /e2e/redraft-league/deck/<tab> (DB-free: fixture fetches, no prisma call) against a `next dev`
 * you started yourself. Mode is set through the real `af_mode` cookie that app/layout.tsx reads.
 * Files land at <out>/<tab>/[<phase>/]<sport>-<mode>-<width>.png, with report.json in <out>.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL; `allfantasy.ai` and its subdomains are
 * refused; /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR. Before each shot it reads back `<html data-mode>`,
 * the workspace's `data-format`/`data-sport`, the computed `--accent`, and that the tab's own root
 * rendered. `--expect-deck` (the AFTER run) also requires the deck root's `data-rd-deck` stamp and that
 * the deck's `--bdx-panel` resolved to /core's `--surface` — i.e. that the redraft re-pointing applied,
 * not merely that a page loaded. A frame that fails a check is an error, not a picture.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
/** tab → the testid of the tab's own root, which must be on screen before the shot. */
const TABS = {
  decide: 'decide-home',
  draft_intel: 'draft-intel-home',
  legacy: 'legacy-home',
  commissioner: 'commissioner-operations-workspace',
}
const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const flag = name => process.argv.includes(`--${name}`)
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
const state = arg('state', 'season')
const expectDeck = flag('expect-deck')
const phase = arg('phase', '')
// Resume after a crash: frames already on disk are kept (the box is memory-constrained).
const skipExisting = flag('skip-existing')
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const t of tabs) if (!TABS[t]) { console.error(`unknown tab ${t}`); process.exit(2) }

fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined })
const report = []
let failures = 0

/**
 * Load one frame. The box is memory-constrained (several dev servers), so a renderer can crash; a
 * crashed page is dead, so each retry gets a FRESH page from the context. Returns the live page.
 */
async function shoot(context, page, url, tab, viewport) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.setViewportSize(viewport)
      await page.goto(url, { waitUntil: 'load', timeout: 180_000 })
      await page.locator('[data-testid=native-league-workspace]').waitFor({ state: 'visible', timeout: 90_000 })
      await page.locator(`[data-testid=${TABS[tab]}]`).first().waitFor({ state: 'visible', timeout: 90_000 })
      await page.evaluate(() => document.fonts?.ready)
      // Let every fixture fetch land: no skeleton left in the tab.
      await page.waitForFunction(() => !document.querySelector('.bdx-skel, .rdk-skel'), null, { timeout: 30_000 }).catch(() => {})
      await page.waitForTimeout(400)
      return page
    } catch (err) {
      if (attempt >= 4) throw err
      console.error(`  retry ${attempt} ${url}: ${String(err).split('\n')[0]}`)
      await page.close().catch(() => {})
      await new Promise(r => setTimeout(r, 4000))
      page = await context.newPage()
    }
  }
}

try {
  for (const mode of modes) {
    const context = await browser.newContext({ deviceScaleFactor: 1 })
    await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
    let page = await context.newPage()
    for (const tab of tabs) {
      fs.mkdirSync(path.join(out, tab, phase), { recursive: true })
      for (const sport of sports) {
        const q = new URLSearchParams({ sport: SPORTS[sport], state, view: tab })
        const url = `${baseUrl}/e2e/redraft-league/deck/${tab}?${q}`
        for (const [label, viewport] of Object.entries(WIDTHS)) {
          if (skipExisting && fs.existsSync(path.join(out, tab, phase, `${sport}-${mode}-${viewport.width}.png`))) continue
          try {
            page = await shoot(context, page, url, tab, viewport)
          } catch (err) {
            failures++
            console.error(`✗ ${tab}/${sport}-${mode}-${viewport.width}: ${String(err).split('\n')[0]}`)
            // A crashed page (memory) is replaced rather than reused.
            await page.close().catch(() => {})
            page = await context.newPage()
            continue
          }
          const read = await page.evaluate(testid => {
            const el = document.querySelector('[data-testid=native-league-workspace]')
            const cs = getComputedStyle(el)
            const tabRoot = document.querySelector(`[data-testid=${testid}]`)
            const bdx = tabRoot?.classList.contains('bdx') ? tabRoot : tabRoot?.querySelector('.bdx')
            return {
              htmlMode: document.documentElement.getAttribute('data-mode'),
              format: el.getAttribute('data-format'),
              sport: el.getAttribute('data-sport'),
              accent: cs.getPropertyValue('--accent').trim(),
              rdAccentText: cs.getPropertyValue('--rd-accent-text').trim(),
              surface: cs.getPropertyValue('--surface').trim(),
              deckStamp: tabRoot?.getAttribute('data-rd-deck') ?? null,
              bdxPanel: bdx ? getComputedStyle(bdx).getPropertyValue('--bdx-panel').trim() : null,
              innerAccent: tabRoot ? getComputedStyle(tabRoot).getPropertyValue('--accent').trim() : null,
              scrollOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
            }
          }, TABS[tab])
          const problems = []
          if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) problems.push(`html data-mode is ${read.htmlMode}, wanted ${HTML_MODE[mode] ?? mode}`)
          if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
          if (read.sport !== sport) problems.push(`data-sport is ${read.sport}`)
          if (!read.accent || read.accent !== read.rdAccentText) problems.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
          if (!read.surface) problems.push('/core palette missing (--surface empty)')
          if (expectDeck) {
            if (read.deckStamp !== sport) problems.push(`deck root data-rd-deck is ${read.deckStamp}`)
            if (read.innerAccent !== read.rdAccentText) problems.push(`tab --accent ${read.innerAccent} is not the sport accent`)
            if (read.bdxPanel != null && read.bdxPanel !== read.surface && read.bdxPanel !== 'var(--surface)') {
              // Custom properties compute to their substituted value; a raw hex here means the remap did not apply.
              if (/^#/.test(read.bdxPanel)) problems.push(`--bdx-panel is ${read.bdxPanel}, not /core's --surface`)
            }
          }
          const file = path.join(tab, phase, `${sport}-${mode}-${viewport.width}.png`)
          report.push({ file, mode, sport, tab, width: viewport.width, ...read, problems })
          if (problems.length) {
            failures++
            console.error(`✗ ${file}: ${problems.join('; ')}`)
            continue
          }
          // The workspace is a 100dvh frame whose content pane scrolls; unlock the height for the shot so
          // the frame holds the whole tab, not the first screenful. Overflow and height only — no layout rule.
          const unlock = await page.addStyleTag({ content: '.nl-workspace{height:auto!important;min-height:100vh!important;overflow:visible!important}.nl-main,.nl-content,[data-testid=redraft-deck-harness]>div{overflow:visible!important;height:auto!important;max-height:none!important}' })
          await page.screenshot({ path: path.join(out, file), fullPage: true })
          await unlock.evaluate(n => n.remove())
          console.log(`✓ ${file}  accent=${read.accent}  panel=${read.bdxPanel}  overflow=${read.scrollOverflow}`)
        }
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
  fs.writeFileSync(path.join(out, `report${phase ? `-${phase}` : ''}.json`), JSON.stringify(report, null, 2))
}
console.log(`${report.length - failures} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
