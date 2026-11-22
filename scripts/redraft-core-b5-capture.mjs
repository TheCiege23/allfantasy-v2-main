#!/usr/bin/env node
/**
 * Screenshot /core batch B5 — Waivers, Player Finder, Draft HQ — for an IMPORTED redraft league, for
 * visual review: screen × sport (the seven redraft-engine sports) × mode (light, dark) × width (1440, 390),
 * plus one dynasty CONTROL frame per screen × mode × width.
 *
 *   node scripts/redraft-core-b5-capture.mjs --base-url http://localhost:3000 --out <dir>/after --state after
 *     [--compare <dir>/before] [--screens waivers,players,draft-hq] [--modes light,dark] [--sports nfl,nba]
 *     [--chromium /opt/pw-browsers/chromium]
 *
 * Renders /e2e/redraft-core/b5/<screen> (DB-free, real AfCoreShell, real screen, fixture data) against a
 * `next dev` you started yourself. `before` is shot from a tree WITHOUT the B5 stylesheet (the stamp is on
 * in both states — the stamp is the base this batch builds on, not the change); `after` from the tree with it.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL, `allfantasy.ai` and its subdomains are
 * refused, and /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR. Every redraft frame must read back
 * `data-format=redraft`, the right `data-sport`, the right `html[data-mode]`, and `--accent` equal to the
 * sport's `--rd-accent-text`. The B5 stylesheet declares `--rd-b5: on` on each screen root under the stamp:
 * `after` must read it, `before` must NOT (or the "before" set is secretly an "after" set). Every control
 * frame must read NO stamp and NO `--rd-b5`. With `--compare <beforeDir>`, each `after` control frame is
 * pixel-compared to its `before` twin in the browser — a dynasty league must render byte-for-byte unchanged.
 * The clock is pinned (`page.clock.setFixedTime`), so the waiver-run countdown cannot make two runs differ.
 * Readings go to report.json beside the PNGs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
const SCREENS = ['waivers', 'players', 'draft-hq']
const ROOT = { waivers: '.af-wv', players: '.af-pf-rail', 'draft-hq': '.af-dh' }
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } }
const FIXED_NOW = new Date('2026-10-25T16:18:00.000Z')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const list = (v, all) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : all)

const baseUrl = arg('base-url')
const out = arg('out')
const state = arg('state')
const compareDir = arg('compare')
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

async function readFrame(page, screen) {
  return page.evaluate((rootSel) => {
    const el = document.querySelector('.af-core.af-shell')
    if (!el) return null
    const cs = getComputedStyle(el)
    const root = document.querySelector(rootSel)
    return {
      htmlMode: document.documentElement.getAttribute('data-mode'),
      format: el.getAttribute('data-format'),
      sport: el.getAttribute('data-sport'),
      accent: cs.getPropertyValue('--accent').trim(),
      rdAccentText: cs.getPropertyValue('--rd-accent-text').trim(),
      surface: cs.getPropertyValue('--surface').trim(),
      screenRoot: Boolean(root),
      b5: root ? getComputedStyle(root).getPropertyValue('--rd-b5').trim() : null,
    }
  }, ROOT[screen])
}

/** Pixel-compare two PNGs inside the browser (no image library in this repo). */
async function diffPixels(page, aPath, bPath) {
  const a = `data:image/png;base64,${fs.readFileSync(aPath).toString('base64')}`
  const b = `data:image/png;base64,${fs.readFileSync(bPath).toString('base64')}`
  return page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true, differing: -1 }
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data }
    const da = px(ia), db = px(ib)
    let differing = 0
    for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) differing++
    return { sizeMismatch: false, differing, total: da.length / 4 }
  }, [a, b])
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
    await page.clock.setFixedTime(FIXED_NOW)
    const frames = []
    for (const screen of screens) {
      for (const sport of sports) frames.push({ screen, sport, leagueType: 'redraft' })
      frames.push({ screen, sport: 'nfl', leagueType: 'dynasty', control: true })
    }
    for (const f of frames) {
      const q = new URLSearchParams({ sport: SPORTS[f.sport], leagueType: f.leagueType, platform: 'sleeper' })
      for (const viewport of Object.values(WIDTHS)) {
        await page.setViewportSize(viewport)
        // Not `networkidle`: `next dev` keeps an HMR socket open, so it never idles.
        await page.goto(`${baseUrl}/e2e/redraft-core/b5/${f.screen}?${q}`, { waitUntil: 'load', timeout: 240_000 })
        await page.locator('[data-testid=redraft-core-b5-fixture]').waitFor({ state: 'visible', timeout: 90_000 })
        // Raced: `document.fonts.ready` once never settled on a dev page (a 25-minute stall mid-run).
        await page.evaluate(() => Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 5000))]))
        // Let the children's 503 states settle so a frame is not caught mid-skeleton.
        await page.waitForTimeout(700)
        const read = await readFrame(page, f.screen)
        const problems = []
        if (!read) problems.push('no .af-core.af-shell root')
        else {
          if (read.htmlMode !== mode) problems.push(`html data-mode is ${read.htmlMode}`)
          if (!read.surface) problems.push('/core palette missing (--surface empty)')
          if (!read.screenRoot) problems.push(`screen root ${ROOT[f.screen]} not rendered`)
          if (f.control) {
            if (read.format || read.sport) problems.push(`control: expected no stamp, got data-format=${read.format} data-sport=${read.sport}`)
            if (read.b5) problems.push(`control: B5 rules reached a dynasty league (--rd-b5=${read.b5})`)
          } else {
            if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
            if (read.sport !== f.sport) problems.push(`data-sport is ${read.sport}`)
            if (!read.accent || read.accent !== read.rdAccentText) problems.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
            if (state === 'after' && read.b5 !== 'on') problems.push(`after: B5 stylesheet not applied (--rd-b5=${read.b5})`)
            if (state === 'before' && read.b5) problems.push(`before: B5 stylesheet already applied (--rd-b5=${read.b5})`)
          }
        }
        const file = `${f.control ? 'control-dynasty-' : ''}${f.screen}-${f.sport}-${mode}-${viewport.width}.png`
        const row = { file, state, mode, ...f, width: viewport.width, ...read, problems }
        report.push(row)
        if (problems.length) {
          failures++
          console.error(`✗ ${file}: ${problems.join('; ')}`)
          continue
        }
        await page.screenshot({ path: path.join(out, file), fullPage: false })
        if (f.control && compareDir && state === 'after') {
          const twin = path.join(compareDir, file)
          if (!fs.existsSync(twin)) row.controlDiff = 'no before twin'
          else {
            const d = await diffPixels(page, twin, path.join(out, file))
            row.controlDiff = d
            if (d.sizeMismatch || d.differing !== 0) {
              failures++
              row.problems.push(`control differs from before: ${JSON.stringify(d)}`)
              console.error(`✗ ${file}: control changed (${JSON.stringify(d)})`)
              continue
            }
          }
        }
        console.log(`✓ ${file}  accent=${read.accent}  b5=${read.b5 || '-'}${row.controlDiff ? `  controlDiff=${JSON.stringify(row.controlDiff)}` : ''}`)
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
