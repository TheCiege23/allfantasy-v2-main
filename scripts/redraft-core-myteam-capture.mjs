#!/usr/bin/env node
/**
 * Screenshot /core batch B2 — My team, Your week, Defense Hub — for visual review:
 *   screen × sport × mode (light, dark[, af]) × width (1440, 390), BEFORE (stamp removed) or AFTER.
 *
 *   node scripts/redraft-core-myteam-capture.mjs --base-url http://localhost:3000 --out <dir> --state after
 *     [--state before] [--screens my-team,week,defense-hub] [--modes light,dark] [--sports nfl,nba] [--chromium <path>]
 *
 * Writes <out>/<screen>/<state>/<sport>-<mode>-<width>.png plus <out>/<screen>/<state>/report.json.
 * Renders /e2e/redraft-core/myteam/<screen> (DB-free: the real AfCoreShell and the real screen with
 * fixture data; every /api/ call is answered in the page) against a `next dev` you started yourself.
 * `--state before` adds `identity=off`, so a before/after pair differs ONLY by the shell's redraft stamp.
 * Defense Hub is IDP-only, and IDP is football: it is shot for NFL alone, as the nav gates it.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL, `allfantasy.ai` and its subdomains are
 * refused, and /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR, in both directions:
 *   - after: `data-format=redraft`, the right `data-sport`, `--accent` = the sport's `--rd-accent-text`,
 *     and one screen-specific READ OF THE EFFECT (a sport chip painted in its tone's token, the period
 *     chip / race line visible, the Defense Hub table framed in the sport line);
 *   - before: no stamp, and the redraft-only elements (period chip, race line) NOT visible;
 *   - every mode also shoots a dynasty control per screen that must carry no stamp — a harness that
 *     stamped everything would otherwise produce a perfect "after" set.
 * It also measures the smallest rendered font size inside the screen (the app's floor is 11px).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
const SCREENS = ['my-team', 'week', 'defense-hub']
const SCREEN_SPORTS = { 'my-team': Object.keys(SPORTS), week: Object.keys(SPORTS), 'defense-hub': ['nfl'] }
const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]
const TONE_TOKEN = { red: '--bad', green: '--good', blue: '--tier-blue-fg', amber: '--warn', violet: '--p-yahoo-fg', slate: '--text2', flex: '--rd-accent-text', bench: '--muted', ir: '--bad' }

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
const sportFilter = list(arg('sports'), Object.keys(SPORTS))
const screens = list(arg('screens'), SCREENS)
for (const s of sportFilter) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const s of screens) if (!SCREENS.includes(s)) { console.error(`unknown screen ${s}`); process.exit(2) }

/** Everything the frame claims, read off the live page. */
async function readFrame(page, screen) {
  return page.evaluate(({ screen, TONE_TOKEN }) => {
    const root = document.querySelector('.af-core.af-shell')
    if (!root) return null
    const cs = getComputedStyle(root)
    const probe = document.createElement('span')
    root.appendChild(probe)
    const tokenColor = (name) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color }
    const visible = (sel) => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0 }
    const effect = {}
    if (screen === 'my-team') {
      const chip = document.querySelector('.af-mt-row:not([data-empty=true]):not([data-bye=true]) .af-mt-slot[data-rd-pos]:not([data-rd-pos=flex]):not([data-rd-pos=bench])')
      if (chip) {
        const tone = chip.getAttribute('data-rd-pos')
        effect.chip = { label: chip.textContent.trim(), tone, color: getComputedStyle(chip).color, expected: tokenColor(TONE_TOKEN[tone]) }
      }
      effect.periodVisible = visible('[data-testid=my-team-lineup-period]')
      effect.periodPresent = !!document.querySelector('[data-testid=my-team-lineup-period]')
      const badge = document.querySelector('[data-testid=my-team-no-game]')
      effect.noGameBadge = !!badge
      if (badge) {
        // Not clipped by the name line's overflow:hidden — the badge's box must sit inside its line.
        const b = badge.getBoundingClientRect()
        const line = badge.parentElement.getBoundingClientRect()
        effect.noGameBadgeVisible = b.width > 0 && b.right <= line.right + 1 && b.bottom <= line.bottom + 1
      }
    } else if (screen === 'week') {
      effect.raceVisible = visible('[data-testid=week-season-race]')
      effect.racePresent = !!document.querySelector('[data-testid=week-season-race]')
      effect.raceText = document.querySelector('[data-testid=week-season-race]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null
    } else {
      const table = document.querySelector('.af-dh-table')
      effect.tableBorder = table ? getComputedStyle(table).borderTopColor : null
      effect.accentLine = tokenColor('--rd-accent-line')
      effect.defaultLine = tokenColor('--line')
    }
    // The smallest rendered font inside the screen body, over elements that carry their own text.
    let minFont = Infinity
    let minAt = null
    for (const el of document.querySelectorAll('[data-testid=redraft-core-myteam-fixture] *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || el.getBoundingClientRect().width === 0) continue
      const px = parseFloat(s.fontSize)
      if (px < minFont) { minFont = px; minAt = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` }
    }
    probe.remove()
    return {
      htmlMode: document.documentElement.getAttribute('data-mode'),
      format: root.getAttribute('data-format'),
      sport: root.getAttribute('data-sport'),
      accent: cs.getPropertyValue('--accent').trim(),
      rdAccentText: cs.getPropertyValue('--rd-accent-text').trim(),
      surface: cs.getPropertyValue('--surface').trim(),
      minFont,
      minAt,
      effect,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }
  }, { screen, TONE_TOKEN })
}

function problemsFor(read, { stamped, screen, sport }) {
  const p = []
  if (!read) return ['no .af-core.af-shell root']
  if (!read.surface) p.push('/core palette missing (--surface empty)')
  if (stamped) {
    if (read.format !== 'redraft') p.push(`data-format is ${read.format}`)
    if (read.sport !== sport) p.push(`data-sport is ${read.sport}`)
    if (!read.accent || read.accent !== read.rdAccentText) p.push(`--accent ${read.accent} is not the sport accent ${read.rdAccentText}`)
    const e = read.effect
    if (screen === 'my-team') {
      if (!e.chip) p.push('no sport position chip found')
      else if (e.chip.color !== e.chip.expected) p.push(`chip ${e.chip.label} (${e.chip.tone}) painted ${e.chip.color}, expected ${e.chip.expected}`)
      if (e.periodPresent && !e.periodVisible) p.push('period chip present but hidden under the stamp')
      if (e.noGameBadge && !e.noGameBadgeVisible) p.push('off-day badge is clipped by the name line')
    }
    if (screen === 'week' && !e.raceVisible) p.push('season-race line not visible under the stamp')
    if (screen === 'defense-hub' && read.effect.tableBorder !== read.effect.accentLine) p.push(`Defense Hub table border ${read.effect.tableBorder} is not the sport line ${read.effect.accentLine}`)
  } else {
    if (read.format || read.sport) p.push(`expected no stamp, got data-format=${read.format} data-sport=${read.sport}`)
    if (read.effect.periodVisible) p.push('period chip visible without the stamp (default look changed)')
    if (read.effect.raceVisible) p.push('season-race line visible without the stamp (default look changed)')
  }
  if (read.minFont < 11) p.push(`text below the 11px floor: ${read.minFont}px at ${read.minAt}`)
  return p
}

// AF_CAPTURE_NO_SHM=1 adds --disable-dev-shm-usage, for a container whose /dev/shm is tiny. It is NOT the
// default: the flag moves shared memory onto /tmp, and on a box whose disk is full that crashes every
// renderer instead (measured 2026-10-31: 16G /dev/shm free, 18M of disk, every frame "Page crashed").
const launch = () => chromium.launch({
  executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined,
  args: process.env.AF_CAPTURE_NO_SHM === '1' ? ['--disable-dev-shm-usage'] : [],
})
let browser = await launch()
let failures = 0
let shots = 0
try {
  for (const screen of screens) {
    const dir = path.join(out, screen, state)
    fs.mkdirSync(dir, { recursive: true })
    const report = []
    for (const mode of modes) {
      let context = null
      let page = null
      /*
       * On a shared box the renderer — or the whole browser — can be OOM-killed mid-run. Rebuild whatever
       * died (browser, context, page) instead of failing every remaining frame against a corpse.
       */
      const fresh = async () => {
        if (!browser.isConnected()) browser = await launch()
        if (context) await context.close().catch(() => {})
        context = await browser.newContext({ deviceScaleFactor: 1 })
        await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
        page = await context.newPage()
      }
      await fresh()
      const frames = SCREEN_SPORTS[screen].filter((s) => sportFilter.includes(s)).map((sport) => ({ sport, leagueType: 'redraft' }))
      frames.push({ sport: SCREEN_SPORTS[screen][0], leagueType: 'dynasty', control: true })
      for (const f of frames) {
        const q = new URLSearchParams({ sport: SPORTS[f.sport], leagueType: f.leagueType })
        if (state === 'before') q.set('identity', 'off')
        for (const viewport of WIDTHS) {
          let read = null
          for (let attempt = 1; attempt <= 4 && !read; attempt++) {
            try {
              // A crashed renderer takes its page with it: start a fresh one rather than reuse a corpse.
              if (page.isClosed() || attempt > 1 || !browser.isConnected()) await fresh()
              await page.setViewportSize(viewport)
              // Not `networkidle`: `next dev` keeps an HMR socket open, so it never idles.
              await page.goto(`${baseUrl}/e2e/redraft-core/myteam/${screen}?${q}`, { waitUntil: 'load', timeout: 240_000 })
              await page.locator('[data-testid=redraft-core-myteam-fixture]').waitFor({ state: 'visible', timeout: 90_000 })
              if (screen === 'defense-hub') await page.locator('.af-dh-table').waitFor({ state: 'visible', timeout: 30_000 })
              await page.evaluate(() => document.fonts?.ready)
              await page.waitForTimeout(400)
              read = await readFrame(page, screen)
            } catch (e) {
              console.error(`  retry ${attempt} ${screen} ${f.sport} ${mode} ${viewport.width}: ${String(e).split('\n')[0]}`)
            }
          }
          if (read && read.htmlMode !== (HTML_MODE[mode] ?? mode)) read.modeProblem = `html data-mode is ${read.htmlMode}`
          const problems = problemsFor(read, { stamped: state === 'after' && !f.control, screen, sport: f.sport })
          if (read?.modeProblem) problems.push(read.modeProblem)
          const file = `${f.control ? 'control-dynasty-' : ''}${f.sport}-${mode}-${viewport.width}.png`
          report.push({ file, screen, state, mode, ...f, width: viewport.width, ...read, problems })
          if (problems.length) {
            failures++
            console.error(`✗ ${screen}/${state}/${file}: ${problems.join('; ')}`)
            continue
          }
          await page.screenshot({ path: path.join(dir, file), fullPage: true })
          shots++
          console.log(`✓ ${screen}/${state}/${file}  accent=${read.accent}  min=${read.minFont}px  ${JSON.stringify(read.effect)}`)
        }
      }
      await context.close().catch(() => {})
    }
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2))
  }
} finally {
  await browser.close()
}
console.log(`${shots} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
