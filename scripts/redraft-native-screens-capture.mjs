#!/usr/bin/env node
/**
 * Screenshot the native league screens (My team, Matchup, Waivers, Trades, Standings, Players) for the
 * redraft visual upgrade, batch A2:  tab × sport (seven) × mode (light, dark) × width (1440, 390).
 *
 *   node scripts/redraft-native-screens-capture.mjs --base-url http://127.0.0.1:3100 --out <dir> --phase before|after
 *     [--tabs roster,matchups] [--sports nfl,nba] [--modes light,dark] [--expect-redraft-screen]
 *
 * Renders /e2e/redraft-league/screens/<tab> (DB-free: the harness answers the screens' own fetches from
 * fixtures) against a `next dev` you started. Mode is set through the real `af_mode` cookie.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL; `allfantasy.ai` and its subdomains are
 * refused; /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR: `<html data-mode>`, the workspace's
 * `data-format`/`data-sport`, the computed `--accent`, the screen's own testid, and (with
 * --expect-redraft-screen, for AFTER frames) the screen's `data-rd-screen` marker are read back first.
 * Writes report.json per phase. Files land in <out>/<tab>/<phase>/<tab>-<sport>-<mode>-<width>.png.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
/** tab → harness route, extra query, the screen testid, and an optional click before the shot. */
const TABS = {
  roster: { route: 'roster', testid: 'native-lineup-screen' },
  matchups: { route: 'matchups', testid: 'native-matchup-screen' },
  waivers: { route: 'waivers', testid: 'native-waivers-screen' },
  trades: { route: 'trades', testid: 'native-trades-screen' },
  standings: { route: 'standings', testid: 'native-standings-screen' },
  'standings-bracket': { route: 'standings', query: { stage: 'playoffs' }, testid: 'native-standings-screen', click: 'Playoff picture' },
  players: { route: 'players', testid: 'players-tab-waiver-subnav' },
}
const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const list = (v, all) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : all)

const baseUrl = arg('base-url')
const out = arg('out')
const phase = arg('phase')
if (!baseUrl || !out || !['before', 'after'].includes(phase)) {
  console.error('usage: --base-url <local dev server> --out <dir> --phase before|after  (no defaults on purpose)')
  process.exit(2)
}
const host = new URL(baseUrl).hostname
if (host === 'allfantasy.ai' || host.endsWith('.allfantasy.ai')) {
  console.error(`refusing ${host}: this harness never runs against production`)
  process.exit(2)
}
const expectRd = process.argv.includes('--expect-redraft-screen')
const modes = list(arg('modes'), ['light', 'dark'])
const sports = list(arg('sports'), Object.keys(SPORTS))
const tabs = list(arg('tabs'), Object.keys(TABS))
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const t of tabs) if (!TABS[t]) { console.error(`unknown tab ${t}`); process.exit(2) }

const launch = () => chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined, args: ['--disable-dev-shm-usage'] })
let browser = await launch()
const report = []
let failures = 0
try {
  for (const mode of modes) {
    let context = null
    let page = null
    /** A shared box can OOM-kill the renderer or the whole browser; either way, start again cleanly. */
    const fresh = async () => {
      if (!browser.isConnected()) browser = await launch()
      if (!context || !context.browser()?.isConnected()) {
        context = await browser.newContext({ deviceScaleFactor: 1 })
        await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
      }
      if (!page || page.isClosed()) page = await context.newPage()
    }
    for (const tab of tabs) {
      const t = TABS[tab]
      const dir = path.join(out, tab, phase)
      fs.mkdirSync(dir, { recursive: true })
      for (const sport of sports) {
        const q = new URLSearchParams({ sport: SPORTS[sport], ...(t.query ?? {}) })
        for (const viewport of Object.values(WIDTHS)) {
          const file = `${tab}-${sport}-${mode}-${viewport.width}.png`
          // --skip-existing: re-run only the frames a previous run could not take.
          if (process.argv.includes('--skip-existing') && fs.existsSync(path.join(dir, file))) continue
          try {
            await fresh()
            await page.setViewportSize(viewport)
            // First frame of a mode (or after a crash): load the page. After that, switch in place.
            const inPage = await page.evaluate(() => typeof window.__rdHarnessGo === 'function').catch(() => false)
            if (inPage) {
              await page.evaluate(([tabId, sp, stage]) => window.__rdHarnessGo({ tab: tabId, sport: sp, stage }), [t.route, SPORTS[sport], t.query?.stage ?? 'season'])
              await page.waitForFunction(([tabId, sp]) => document.querySelector(`[data-testid=redraft-screens-harness][data-harness-tab=${tabId}][data-harness-sport=${sp}]`), [t.route, SPORTS[sport]], { timeout: 30_000 })
            } else {
              await page.goto(`${baseUrl}/e2e/redraft-league/screens/${t.route}?${q}`, { waitUntil: 'load', timeout: 240_000 })
              await page.addStyleTag({ content: '.nl-workspace,.nl-main,.nl-content{height:auto!important;max-height:none!important;overflow:visible!important}' })
            }
            await page.locator(`[data-testid=${t.testid}]`).first().waitFor({ state: 'visible', timeout: 90_000 })
            // The screens load their data after mount; wait until no loading line is left.
            await page.waitForFunction(() => !document.querySelector('.nls-empty[role=status]'), null, { timeout: 30_000 }).catch(() => {})
            if (t.click) {
              await page.getByRole('button', { name: t.click }).first().click()
              await page.waitForTimeout(400)
            }
            await page.evaluate(() => document.fonts?.ready)
            await page.waitForTimeout(300)
            await page.evaluate(() => window.scrollTo(0, 0))
            const read = await page.evaluate(testid => {
              const el = document.querySelector('[data-testid=native-league-workspace]')
              const cs = el ? getComputedStyle(el) : null
              const screen = document.querySelector(`[data-testid=${testid}]`)
              return {
                htmlMode: document.documentElement.getAttribute('data-mode'),
                format: el?.getAttribute('data-format') ?? null,
                sport: el?.getAttribute('data-sport') ?? null,
                accent: cs?.getPropertyValue('--accent').trim() ?? null,
                rdAccentText: cs?.getPropertyValue('--rd-accent-text').trim() ?? null,
                screen: Boolean(screen),
                rdScreen: Boolean(document.querySelector('[data-rd-screen]')),
                hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
                mobileQuery: window.matchMedia('(max-width: 767px)').matches,
              }
            }, t.testid)
            const problems = []
            if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) problems.push(`html data-mode is ${read.htmlMode}, wanted ${HTML_MODE[mode] ?? mode}`)
            if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
            if (read.sport !== sport) problems.push(`data-sport is ${read.sport}`)
            if (!read.accent || read.accent !== read.rdAccentText) problems.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
            if (!read.screen) problems.push(`screen ${t.testid} not rendered`)
            if (expectRd && !read.rdScreen) problems.push('no [data-rd-screen] marker: the redraft screen did not render')
            report.push({ file, phase, mode, sport, tab, width: viewport.width, ...read, problems })
            if (problems.length) {
              failures++
              console.error(`✗ ${file}: ${problems.join('; ')}`)
              continue
            }
            await page.screenshot({ path: path.join(dir, file), fullPage: true })
            console.log(`✓ ${tab}/${phase}/${file}  accent=${read.accent}${read.hScroll ? '  ⚠ horizontal scroll' : ''}`)
          } catch (e) {
            await page?.close().catch(() => {})
            failures++
            report.push({ file, phase, mode, sport, tab, width: viewport.width, problems: [String(e?.message ?? e).slice(0, 300)] })
            console.error(`✗ ${file}: ${String(e?.message ?? e).split('\n')[0]}`)
          }
        }
      }
    }
    await context?.close().catch(() => {})
  }
} finally {
  await browser.close().catch(() => {})
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, `report-${phase}.json`), JSON.stringify(report, null, 2))
}
console.log(`${report.length - failures} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
