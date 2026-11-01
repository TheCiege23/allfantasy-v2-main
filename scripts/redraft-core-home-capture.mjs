#!/usr/bin/env node
/**
 * Screenshot /core's league Home for an IMPORTED redraft league (batch B-ID), for visual review:
 *   sport (the seven redraft-engine sports) × mode (light, dark[, af]) × width (1440, 390).
 *
 *   node scripts/redraft-core-home-capture.mjs --base-url http://localhost:3000 --out <dir> --state after
 *     [--state before] [--modes light,dark,af] [--sports nfl,nba] [--chromium <path>] [--full] [--skip-existing]
 *
 * Renders /e2e/redraft-core/home (DB-free; the real AfCoreShell + the real LeagueHome on fixture data)
 * against a `next dev` you started yourself. `--state before` adds `identity=off`: no shell stamp and
 * no deck, i.e. what an imported redraft league rendered before this batch. scripts/redraft-core-
 * capture.mjs (the shell batch) is left untouched.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL; `allfantasy.ai` and its subdomains are
 * refused, and /e2e/* is notFound() in production anyway.
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR — in both directions. `after` must read back the
 * stamp, the sport, `--accent` equal to `--rd-accent-text`, and a rendered deck; `before` must read back
 * no stamp and no deck. Each mode also shoots a dynasty CONTROL frame that must carry neither — a
 * harness that themed every league would otherwise produce a perfect "after" set. A page that crashed
 * (memory is tight with one dev server) is retried twice on a fresh page before the frame is refused.
 * Readings go to report-<state>.json beside the PNGs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = ['nfl', 'nba', 'nhl', 'mlb', 'ncaaf', 'ncaab', 'soccer']
const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = { desktop: { width: 1440, height: 1100 }, phone: { width: 390, height: 844 } }

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
const sports = list(arg('sports'), SPORTS)
for (const s of sports) if (!SPORTS.includes(s)) { console.error(`unknown sport ${s}`); process.exit(2) }
const fullPage = process.argv.includes('--full')

async function readFrame(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.af-core.af-shell')
    if (!el) return null
    const cs = getComputedStyle(el)
    const deck = document.querySelector('[data-testid=redraft-home-deck]')
    return {
      htmlMode: document.documentElement.getAttribute('data-mode'),
      format: el.getAttribute('data-format'),
      sport: el.getAttribute('data-sport'),
      accent: cs.getPropertyValue('--accent').trim(),
      rdAccentText: cs.getPropertyValue('--rd-accent-text').trim(),
      surface: cs.getPropertyValue('--surface').trim(),
      deck: Boolean(deck),
      deckBlocks: deck ? ['redraft-score-bug', 'redraft-playoff-race', 'redraft-recap'].filter(id => deck.querySelector(`[data-testid=${id}]`)) : [],
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }
  })
}

const skipExisting = process.argv.includes('--skip-existing')
const executablePath = arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined

/*
 * ⚠ MEMORY IS TIGHT ON THE SHARED BOX, SO A RENDERER CAN CRASH. A crashed page is never reused (every
 * later goto on it fails with "Target closed"): each attempt gets a FRESH page, and a browser that died
 * altogether is relaunched. `--skip-existing` resumes a run without reshooting frames already on disk.
 */
let browser = null
async function freshContext(mode) {
  if (!browser || !browser.isConnected()) browser = await chromium.launch({ executablePath })
  const context = await browser.newContext({ deviceScaleFactor: 1 })
  await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
  return context
}

async function load(mode, viewport, url) {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    let context = null
    try {
      context = await freshContext(mode)
      const page = await context.newPage()
      await page.setViewportSize(viewport)
      // Not `networkidle`: `next dev` keeps an HMR socket open, so it never idles.
      await page.goto(url, { waitUntil: 'load', timeout: 180_000 })
      await page.locator('.af-lh').waitFor({ state: 'visible', timeout: 90_000 })
      await page.evaluate(() => document.fonts?.ready)
      return { page, context }
    } catch (error) {
      lastError = error
      await context?.close().catch(() => {})
      console.error(`  retry ${attempt}/3 ${url}: ${String(error?.message ?? error).split('\n')[0]}`)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  return { error: lastError }
}

fs.mkdirSync(out, { recursive: true })
const report = []
let failures = 0
try {
  for (const mode of modes) {
    const frames = sports.map(sport => ({ sport, leagueType: 'redraft' }))
    frames.push({ sport: 'nfl', leagueType: 'dynasty', control: true })
    for (const f of frames) {
      const q = new URLSearchParams({ sport: f.sport, leagueType: f.leagueType })
      if (state === 'before') q.set('identity', 'off')
      for (const viewport of Object.values(WIDTHS)) {
        const file = `${f.control ? 'control-dynasty' : 'home'}-${f.sport}-${mode}-${viewport.width}.png`
        if (skipExisting && fs.existsSync(path.join(out, file))) {
          console.log(`- ${file} (exists)`)
          continue
        }
        const loaded = await load(mode, viewport, `${baseUrl}/e2e/redraft-core/home?${q}`)
        if (!loaded.page) {
          failures++
          report.push({ file, state, mode, ...f, width: viewport.width, problems: ['page did not load after 3 attempts'] })
          console.error(`✗ ${file}: did not load`)
          continue
        }
        const { page, context } = loaded
        const read = await readFrame(page)
        const problems = []
        const stamped = state === 'after' && !f.control
        if (!read) problems.push('no .af-core.af-shell root')
        else {
          if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) problems.push(`html data-mode is ${read.htmlMode}`)
          if (!read.surface) problems.push('/core palette missing (--surface empty)')
          if (read.horizontalOverflow) problems.push('page scrolls horizontally')
          if (stamped) {
            if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
            if (read.sport !== f.sport) problems.push(`data-sport is ${read.sport}`)
            if (!read.accent || read.accent !== read.rdAccentText) problems.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
            if (!read.deck) problems.push('no redraft deck rendered')
          } else {
            if (read.format || read.sport) problems.push(`expected no stamp, got data-format=${read.format} data-sport=${read.sport}`)
            if (read.deck) problems.push('expected no deck, but one rendered')
          }
        }
        report.push({ file, state, mode, ...f, width: viewport.width, ...read, problems })
        if (problems.length) {
          failures++
          console.error(`✗ ${file}: ${problems.join('; ')}`)
        } else {
          await page.screenshot({ path: path.join(out, file), fullPage })
          console.log(`✓ ${file}  accent=${read.accent}  blocks=${read.deckBlocks.join(',') || '-'}`)
        }
        await context.close().catch(() => {})
      }
    }
  }
} finally {
  await browser?.close().catch(() => {})
  fs.writeFileSync(path.join(out, `report-${state}.json`), JSON.stringify(report, null, 2))
}
console.log(`${report.length - failures} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
