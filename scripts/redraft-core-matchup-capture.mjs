#!/usr/bin/env node
/**
 * Screenshot the REAL /core Matchup and Live scores screens with a native redraft league open
 * (batch B3), for visual review: screen × sport (the seven redraft-engine sports) × mode × width.
 *
 *   node scripts/redraft-core-matchup-capture.mjs --base-url http://127.0.0.1:3317 --out <dir> --state after
 *     [--state before] [--resume] [--screens matchup,live] [--modes light,dark] [--sports nfl,nba] [--chromium <path>]
 *
 * Writes <out>/<screen>/<state>/<frame>.jpg plus <out>/<screen>/<state>/report.json.
 *
 * Renders /e2e/redraft-core/matchup/<screen> (DB-free, real AfCoreShell, real screen, fixture data)
 * against a `next dev` you started yourself. `--state before` renders the SAME stamped shell with this
 * batch's stylesheet (components/core-app/af-core-redraft-matchup.css) switched off in the page and its
 * three new redraft-only elements hidden — i.e. the screens exactly as #3095 left them — so a pair
 * differs only by this batch.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL, `allfantasy.ai` and its subdomains are
 * refused, and /e2e/* is notFound() in production anyway (app/e2e/layout.tsx). The screens' own polls
 * are answered HERE (304 for the live-scores poll, 503 for anything else under /api) and every request
 * off the dev server's origin gets a 404, so a capture reaches no database and no provider.
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR, IN BOTH DIRECTIONS. Every frame must read back the
 * stamp it expects and the batch stylesheet in the state it expects (found and on for `after`, found and
 * off for `before`). `after` frames must also show the EFFECT, read from computed style, not from source:
 * the LIVE bar is --bad, a final week draws no win probability, a live week does, no bar reads "Q0",
 * nothing visible is under 11px, and a phone frame does not scroll sideways. Each mode also shoots one
 * dynasty control frame that must carry no stamp and show none of the redraft-only elements — a harness
 * that styled everything would otherwise produce a perfect "after" set.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
const SCREENS = ['matchup', 'live']
const HTML_MODE = { light: 'light', dark: 'dark', af: 'legacy' }
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } }
const MARKER = 'af-mu-rd-final'

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
const origin = new URL(baseUrl).origin
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

/**
 * This batch's rules, as they sit in the page: every rule (or @media / @container block) whose text
 * names the redraft stamp AND a Matchup / Live class. Neither foundation sheet has one
 * (redraft-identity.css and af-core-redraft.css name no af-mu / af-live class), so this is exactly the
 * batch file's scoped rules. Its three unscoped hide rules are not matched, which is what `before`
 * wants: the new elements stay hidden, as they would be without the batch.
 */
const BATCH_RULE = (t) => /data-format="?redraft/.test(t) && /\.af-(mu|live)-/.test(t)

/** `before`: delete this batch's rules from the page; report how many were removed. */
async function applyBefore(page) {
  /*
   * 🛑 RULES, NOT SHEETS. The first version disabled the whole stylesheet that contained the batch, and
   * `next dev` bundles every CSS import of a route into ONE sheet — so it shot a completely unstyled
   * page as "before". The `--surface` check in problemsFor now refuses a frame like that.
   *
   * ⚠ A copy can also arrive after the first sweep (both screens import the file), so sweep until two
   * sweeps in a row find nothing.
   */
  const sweep = () =>
    page.evaluate((src) => {
      const isBatch = new Function('t', `return (${src})(t)`)
      let found = 0
      /*
       * 🛑 LEAF RULES ONLY, recursing into @media / @container / @layer / @supports. A grouping rule's
       * cssText contains every rule inside it, so testing the GROUP deletes whatever else it wraps — the
       * second version did exactly that and shot unstyled pages as "before" whenever the dev bundle
       * wrapped the whole route's CSS in one group. A group emptied by the sweep is left in place: an
       * empty block styles nothing.
       */
      const prune = (owner, rules) => {
        for (let i = rules.length - 1; i >= 0; i--) {
          const r = rules[i]
          if (r.cssRules && !(r instanceof CSSStyleRule)) prune(r, r.cssRules)
          else if (isBatch(r.cssText)) { owner.deleteRule(i); found++ }
        }
      }
      for (const sheet of document.styleSheets) {
        let rules
        try { rules = sheet.cssRules } catch { continue }
        prune(sheet, rules)
      }
      return found
    }, BATCH_RULE.toString())
  let total = 0
  let quiet = 0
  for (let i = 0; i < 12 && quiet < 2; i++) {
    const n = await sweep()
    total += n
    quiet = n === 0 ? quiet + 1 : 0
    await new Promise((r) => setTimeout(r, 600))
  }
  return total
}

async function readFrame(page, screen) {
  return page.evaluate(({ src, screen }) => {
    const root = document.querySelector('.af-core.af-shell')
    if (!root) return null
    const isBatch = new Function('t', `return (${src})(t)`)
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0
    const anyLeaf = (rules) => [...rules].some(r => (r.cssRules && !(r instanceof CSSStyleRule) ? anyLeaf(r.cssRules) : isBatch(r.cssText)))
    const sheetOn = [...document.styleSheets].some(s => {
      try { return !s.disabled && anyLeaf(s.cssRules) } catch { return false }
    })
    /*
     * Is the page STYLED at all? The /core palette token alone did not catch an unstyled frame, so also
     * read where the screen sits: styled, it starts under the top bar (~130px); unstyled, the shell's
     * nav prints as a list above it and pushes it ~1,700px down.
     */
    const fixture = document.querySelector('[data-testid=redraft-core-matchup-fixture]')
    const fixtureTop = fixture ? Math.round(fixture.getBoundingClientRect().top + window.scrollY) : null
    const surface = getComputedStyle(root).getPropertyValue('--surface').trim() && fixtureTop != null && fixtureTop < 400 ? 'ok' : ''
    /* --bad resolved to a colour, for comparing against computed backgrounds. */
    const probe = document.createElement('span')
    probe.style.color = 'var(--bad)'
    root.appendChild(probe)
    const bad = getComputedStyle(probe).color
    probe.remove()
    const body = document.querySelector('[data-testid=redraft-core-matchup-fixture]')
    let small = []
    if (body) {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement
        if (!el || !n.textContent.trim() || !shown(el)) continue
        const px = parseFloat(getComputedStyle(el).fontSize)
        if (px < 11) small.push(`${el.className || el.tagName}:${px}px "${n.textContent.trim().slice(0, 20)}"`)
      }
    }
    const out = {
      htmlMode: document.documentElement.getAttribute('data-mode'),
      format: root.getAttribute('data-format'),
      sport: root.getAttribute('data-sport'),
      sheetOn,
      surface,
      bad,
      small: small.slice(0, 5),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      rdOnlyShown: [...document.querySelectorAll('.af-mu-rd-final,.af-mu-rd-only,.af-live-bug-word')].filter(shown).length,
    }
    if (screen === 'matchup') {
      const mu = document.querySelector('.af-mu')
      const chip = document.querySelector('.af-mu-week-state')
      out.week = mu?.getAttribute('data-week') ?? null
      out.chipBg = chip ? getComputedStyle(chip).backgroundColor : null
      out.wpShown = shown(document.querySelector('.af-mu-wp'))
      out.wpValueShown = shown(document.querySelector('.af-mu-centre-value'))
      out.finalMarks = [...document.querySelectorAll('.af-mu-rd-final')].filter(shown).length
    } else {
      const heads = [...document.querySelectorAll('.af-live-game[data-state=live] > .af-live-game-head')]
      out.liveHeads = heads.length
      out.liveHeadBgs = [...new Set(heads.map(h => getComputedStyle(h).backgroundColor))]
      out.headTexts = [...document.querySelectorAll('.af-live-game-head')].map(h => h.innerText.replace(/\s+/g, ' ').trim())
    }
    return out
  }, { src: BATCH_RULE.toString(), screen })
}

function problemsFor(read, f, mode) {
  const p = []
  if (!read) return ['no .af-core.af-shell root']
  if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) p.push(`html data-mode is ${read.htmlMode}`)
  if (!read.surface) p.push('page is unstyled (no /core palette, or the screen pushed down by an unstyled shell)')
  if (f.control) {
    if (read.format || read.sport) p.push(`control carries a stamp: ${read.format}/${read.sport}`)
    if (read.rdOnlyShown) p.push(`control shows ${read.rdOnlyShown} redraft-only element(s)`)
    return p
  }
  if (read.format !== 'redraft' || read.sport !== f.sport) p.push(`stamp is ${read.format}/${read.sport}, wanted redraft/${f.sport}`)
  if (state === 'before') {
    if (read.sheetOn) p.push('batch rules still on in a before frame')
    if (!read.beforeFound) p.push('batch rules not found to remove — this frame would be an after')
    return p
  }
  if (!read.sheetOn) p.push('batch stylesheet missing')
  if (read.small.length) p.push(`text under 11px: ${read.small.join(', ')}`)
  if (read.overflowX > 0) p.push(`page scrolls sideways by ${read.overflowX}px`)
  if (f.screen === 'matchup') {
    if (read.week !== f.weekState) p.push(`data-week is ${read.week}, wanted ${f.weekState}`)
    if (f.weekState === 'live' && read.chipBg !== read.bad) p.push(`LIVE chip is ${read.chipBg}, not --bad ${read.bad}`)
    if (f.weekState === 'final' && (read.wpShown || read.wpValueShown)) p.push('a FINAL week still draws a win probability')
    if (f.weekState !== 'final' && !(read.wpShown && read.wpValueShown)) p.push('win probability provided but not drawn')
    if (f.weekState !== 'upcoming' && read.finalMarks === 0) p.push('no final-game marker on a scored board')
  } else {
    if (!read.liveHeads) p.push('no live game card')
    if (read.liveHeadBgs.length !== 1 || read.liveHeadBgs[0] !== read.bad) p.push(`live bars are ${read.liveHeadBgs.join('|')}, not --bad ${read.bad}`)
    const q0 = read.headTexts.find(t => /\b(Q|P)0\b|Inn 0\b/.test(t))
    if (q0) p.push(`a bar reads a period zero: "${q0}"`)
    if (f.sport === 'nhl' && !read.headTexts.some(t => /\bOT\b/.test(t))) p.push('NHL fourth period did not read OT')
  }
  return p
}

fs.mkdirSync(out, { recursive: true })
const executablePath = arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined
/* `--resume` keeps frames already on disk — a run killed under memory pressure picks up where it stopped. */
const resume = process.argv.includes('--resume')

/*
 * Several `next dev` servers share this box, and the kernel's OOM killer takes Chromium first. So the
 * browser, its context and its page are re-made whenever any of them is gone, rather than once.
 */
let browser = null
let context = null
let page = null
let contextMode = null
async function freshPage(mode, force) {
  if (!browser || !browser.isConnected()) {
    await browser?.close().catch(() => {})
    browser = await chromium.launch({ executablePath })
    context = null
  }
  if (!context || contextMode !== mode || force) {
    await context?.close().catch(() => {})
    context = await browser.newContext({ deviceScaleFactor: 1 })
    contextMode = mode
    await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      // Off-origin (player headshots, crests): a 404, so each image takes its own fallback, not a broken icon.
      if (url.origin !== origin) return route.fulfill({ status: 404, body: '' })
      if (url.pathname.startsWith('/api/dashboard/live-scores')) return route.fulfill({ status: 304, body: '' })
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"harness"}' })
      return route.continue()
    })
    page = null
  }
  if (!page || page.isClosed() || force) {
    await page?.close().catch(() => {})
    page = await context.newPage()
  }
  return page
}

let failures = 0
let shots = 0
try {
  for (const screen of screens) {
    const dir = path.join(out, screen, state)
    fs.mkdirSync(dir, { recursive: true })
    const report = []
    for (const mode of modes) {
      const frames = []
      for (const sport of sports) {
        if (screen === 'matchup') {
          frames.push({ screen, sport, weekState: 'live' })
          if (sport === 'nfl' || sport === 'nba') frames.push({ screen, sport, weekState: 'final' }, { screen, sport, weekState: 'upcoming' })
        } else frames.push({ screen, sport })
      }
      frames.push({ screen, sport: 'nfl', weekState: screen === 'matchup' ? 'live' : undefined, control: true })
      for (const f of frames) {
        const q = new URLSearchParams({ sport: SPORTS[f.sport], leagueType: f.control ? 'dynasty' : 'redraft' })
        if (f.weekState) q.set('state', f.weekState)
        for (const [, viewport] of Object.entries(WIDTHS)) {
          const name = `${f.control ? 'control-dynasty' : f.sport}${f.weekState && screen === 'matchup' ? `-${f.weekState}` : ''}-${mode}-${viewport.width}.jpg`
          if (resume && fs.existsSync(path.join(dir, name))) {
            console.log(`· ${screen}/${state}/${name} (kept)`)
            continue
          }
          let read = null
          let shot = false
          for (let attempt = 1; attempt <= 5 && !shot; attempt++) {
            try {
              if (attempt > 1) await new Promise((r) => setTimeout(r, 4000 * attempt))
              const p = await freshPage(mode, attempt > 1)
              await p.setViewportSize(viewport)
              // Not `networkidle`: `next dev` keeps an HMR socket open, so it never idles.
              await p.goto(`${baseUrl}/e2e/redraft-core/matchup/${screen}?${q}`, { waitUntil: 'load', timeout: 240_000 })
              await p.locator('[data-testid=redraft-core-matchup-fixture]').waitFor({ state: 'visible', timeout: 90_000 })
              await p.evaluate(() => document.fonts?.ready)
              /* `next dev` attaches CSS asynchronously: wait for this batch's sheet, or the read below would
               * measure a half-styled page. A timeout here is not fatal — the frame is then REFUSED by the
               * "stylesheet missing" check rather than shot. */
              await p
                .waitForFunction((m) => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.cssText.includes(m)) } catch { return false } }), MARKER, { timeout: 30_000 })
                .catch(() => {})
              const beforeFound = state === 'before' && !f.control ? await applyBefore(p) : 0
              read = await readFrame(p, screen)
              if (read) read.beforeFound = beforeFound
              const problems = problemsFor(read, f, mode)
              // One re-read for a page caught mid-load; a second refusal stands.
              if (problems.length) { if (attempt === 1) continue; break }
              // JPEG: this box's disk is shared and tight; a full-page PNG per frame does not fit.
              await p.screenshot({ path: path.join(dir, name), fullPage: true, type: 'jpeg', quality: 72 })
              shot = true
            } catch (e) {
              console.error(`  retry ${attempt}: ${String(e.message).split('\n')[0]}`)
            }
          }
          const problems = shot ? [] : problemsFor(read, f, mode)
          if (!shot && !problems.length) problems.push('could not shoot the frame (browser kept dying)')
          report.push({ file: name, state, mode, ...f, width: viewport.width, ...read, problems })
          if (problems.length) {
            failures++
            console.error(`✗ ${screen}/${state}/${name}: ${problems.join('; ')}`)
            continue
          }
          shots++
          console.log(`✓ ${screen}/${state}/${name}`)
        }
      }
    }
    fs.writeFileSync(path.join(dir, resume ? `report-${Date.now()}.json` : 'report.json'), JSON.stringify(report, null, 2))
  }
} finally {
  await browser?.close().catch(() => {})
}
console.log(`${shots} captured, ${failures} refused → ${out}`)
process.exit(failures ? 1 : 0)
