#!/usr/bin/env node
/**
 * Screenshot the native League Settings page for the redraft visual upgrade (wave-2 A5):
 *   view (commissioner, member) × sport (seven) × mode (light, dark) × width (1440, 390), plus a
 *   dynasty control (NFL, light/dark, 1440/390) that must not change at all.
 *
 *   node scripts/redraft-settings-capture.mjs --base-url http://127.0.0.1:3105 --out <dir> --phase before|after
 *     [--views commish,member,control] [--sports nfl,nba] [--modes light,dark] [--expect-redraft-settings]
 *
 * Renders /e2e/redraft-league/settings (DB-free: the harness answers the page's own GETs from fixtures)
 * against a `next dev` you started. Mode is set through the real `af_mode` cookie. The member view is
 * shot at 1440 only — at 390 it is the same list the commissioner sees, minus the edit chevrons.
 *
 * 🛑 A LOCAL OR STAGING DEV SERVER ONLY. No default base URL; `allfantasy.ai` and its subdomains are
 * refused; /e2e/* is notFound() in production anyway (app/e2e/layout.tsx).
 *
 * ⚠ IT REFUSES TO SHOOT A FRAME IT CANNOT VOUCH FOR: `<html data-mode>`, the workspace's
 * `data-format`/`data-sport`, the computed `--accent` on the settings root (which is a second `.af-core`
 * and so re-declares /core's palette — see redraft-settings.css), the page's testid, and (with
 * --expect-redraft-settings, for AFTER frames) the `[data-rd-settings]` marker are read back first. A
 * control frame must have NO redraft stamp and NO marker.
 *
 * Control frames also record a digest of the settings page's markup and computed styles; when both
 * report-before.json and report-after.json exist, the after run compares them and fails on any change.
 * Files: <out>/<phase>/settings-<view>-<sport>-<mode>-<width>.png, plus <out>/report-<phase>.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', ncaaf: 'NCAAF', ncaab: 'NCAAB', soccer: 'SOCCER' }
const VIEWS = {
  commish: { role: 'commissioner', widths: ['desktop', 'phone'] },
  member: { role: 'member', widths: ['desktop'] },
  control: { role: 'commissioner', widths: ['desktop', 'phone'], query: { leagueType: 'dynasty' }, sports: ['nfl'], control: true },
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
const expectRd = process.argv.includes('--expect-redraft-settings')
const modes = list(arg('modes'), ['light', 'dark'])
const sports = list(arg('sports'), Object.keys(SPORTS))
const views = list(arg('views'), Object.keys(VIEWS))
for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2) }
for (const v of views) if (!VIEWS[v]) { console.error(`unknown view ${v}`); process.exit(2) }

const ROOT = '[data-testid=commissioner-center],[data-testid=league-settings-home]'
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)

const launch = () => chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined, args: ['--disable-dev-shm-usage'] })
let browser = await launch()
const report = []
let failures = 0
const dir = path.join(out, phase)
fs.mkdirSync(dir, { recursive: true })
try {
  for (const mode of modes) {
    let context = null
    let page = null
    let loadedQuery = null
    /** A shared box can OOM-kill the renderer or the whole browser; either way, start again cleanly. */
    const fresh = async () => {
      if (!browser.isConnected()) browser = await launch()
      if (!context || !context.browser()?.isConnected()) {
        context = await browser.newContext({ deviceScaleFactor: 1 })
        await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
        loadedQuery = null
      }
      if (!page || page.isClosed()) { page = await context.newPage(); loadedQuery = null }
    }
    for (const viewKey of views) {
      const v = VIEWS[viewKey]
      for (const sport of v.sports ?? sports) {
        if (v.sports && !sports.includes(sport) && arg('sports')) continue
        const q = new URLSearchParams({ sport: SPORTS[sport], role: v.role, ...(v.query ?? {}) })
        // Only sport and role switch in place; a different leagueType is a different page load.
        const pageKey = JSON.stringify(v.query ?? {})
        for (const wKey of v.widths) {
          const viewport = WIDTHS[wKey]
          const file = `settings-${viewKey}-${sport}-${mode}-${viewport.width}.png`
          if (process.argv.includes('--skip-existing') && fs.existsSync(path.join(dir, file))) continue
          try {
            await fresh()
            await page.setViewportSize(viewport)
            const inPage = loadedQuery === pageKey && (await page.evaluate(() => typeof window.__rdSettingsGo === 'function').catch(() => false))
            if (inPage) {
              await page.evaluate(([sp, role]) => window.__rdSettingsGo({ sport: sp, role }), [SPORTS[sport], v.role])
              await page.waitForFunction(([sp, role]) => document.querySelector(`[data-testid=redraft-settings-harness][data-harness-sport=${sp}][data-harness-role=${role}]`), [SPORTS[sport], v.role], { timeout: 30_000 })
            } else {
              await page.goto(`${baseUrl}/e2e/redraft-league/settings?${q}`, { waitUntil: 'load', timeout: 240_000 })
              await page.addStyleTag({ content: '.nl-workspace,.nl-main,.nl-content{height:auto!important;max-height:none!important;overflow:visible!important}' })
              loadedQuery = pageKey
            }
            await page.locator(ROOT).first().waitFor({ state: 'visible', timeout: 90_000 })
            // The roster and draft rows load after mount; wait until none is still pending.
            await page.waitForFunction(() => !document.querySelector('.lsh-value[data-pending=true]'), null, { timeout: 30_000 }).catch(() => {})
            // The Commissioner center's editor is a dynamic import; do not photograph its "Loading…" line.
            await page.waitForFunction(() => ![...document.querySelectorAll('.cc-pane-body .lsh-help')].some(el => el.textContent?.trim() === 'Loading…'), null, { timeout: 60_000 }).catch(() => {})
            await page.evaluate(() => document.fonts?.ready)
            await page.waitForTimeout(400)
            await page.evaluate(() => window.scrollTo(0, 0))
            const read = await page.evaluate(rootSel => {
              const ws = document.querySelector('[data-testid=native-league-workspace]')
              const root = document.querySelector(rootSel)
              const rcs = root ? getComputedStyle(root) : null
              const wcs = ws ? getComputedStyle(ws) : null
              // Markup + the computed styles that the redraft file could touch, for the control digest.
              const PROPS = ['color', 'background-color', 'background-image', 'border-top-color', 'border-left-color', 'box-shadow', 'font-size', 'font-weight', 'padding-left', 'margin-right', 'border-radius', 'text-transform']
              const styles = root ? [root, ...root.querySelectorAll('*')].map(el => { const cs = getComputedStyle(el); return PROPS.map(p => cs.getPropertyValue(p)).join('|') }).join('\n') : ''
              return {
                htmlMode: document.documentElement.getAttribute('data-mode'),
                format: ws?.getAttribute('data-format') ?? null,
                sport: ws?.getAttribute('data-sport') ?? null,
                wsAccent: wcs?.getPropertyValue('--accent').trim() ?? null,
                rootAccent: rcs?.getPropertyValue('--accent').trim() ?? null,
                rdAccentText: wcs?.getPropertyValue('--rd-accent-text').trim() ?? null,
                root: root?.getAttribute('data-testid') ?? null,
                rdSettings: root?.getAttribute('data-rd-settings') ?? null,
                whenCount: document.querySelectorAll('.lsh-rd-when,.cc-rd-when').length,
                markup: root?.outerHTML ?? '',
                styles,
                hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
              }
            }, ROOT)
            const { markup, styles, ...facts } = read
            const digest = { markup: sha(markup), styles: sha(styles) }
            const problems = []
            if (read.htmlMode !== (HTML_MODE[mode] ?? mode)) problems.push(`html data-mode is ${read.htmlMode}, wanted ${HTML_MODE[mode] ?? mode}`)
            if (!read.root) problems.push('settings page not rendered')
            if (v.control) {
              if (read.format === 'redraft') problems.push('control frame carries data-format=redraft')
              if (read.rdSettings) problems.push('control frame carries data-rd-settings')
              if (read.whenCount) problems.push('control frame renders redraft eyebrows')
            } else {
              if (read.format !== 'redraft') problems.push(`data-format is ${read.format}`)
              if (read.sport !== sport) problems.push(`data-sport is ${read.sport}`)
              if (!read.wsAccent || read.wsAccent !== read.rdAccentText) problems.push(`workspace --accent ${read.wsAccent} is not the sport accent ${read.rdAccentText}`)
              if (expectRd) {
                if (read.rdSettings !== 'true') problems.push('no [data-rd-settings] marker: the redraft settings page did not render')
                if (read.rootAccent !== read.rdAccentText) problems.push(`settings root --accent ${read.rootAccent} is not the sport accent ${read.rdAccentText}`)
                if (!read.whenCount) problems.push('no season eyebrows rendered')
              }
            }
            const entry = { file, phase, mode, sport, view: viewKey, width: viewport.width, ...facts, digest, problems }
            report.push(entry)
            if (problems.length) {
              failures++
              console.error(`✗ ${file}: ${problems.join('; ')}`)
              continue
            }
            const png = await page.screenshot({ path: path.join(dir, file), fullPage: true })
            entry.png = sha(png)
            console.log(`✓ ${phase}/${file}  accent=${read.rootAccent}${read.hScroll ? '  ⚠ horizontal scroll' : ''}`)
          } catch (e) {
            await page?.close().catch(() => {})
            failures++
            report.push({ file, phase, mode, sport, view: viewKey, width: viewport.width, problems: [String(e?.message ?? e).slice(0, 300)] })
            console.error(`✗ ${file}: ${String(e?.message ?? e).split('\n')[0]}`)
          }
        }
      }
    }
    await context?.close().catch(() => {})
  }
} finally {
  await browser.close().catch(() => {})
  fs.writeFileSync(path.join(out, `report-${phase}.json`), JSON.stringify(report, null, 2))
}

// The control must be unchanged: same markup, same computed styles, same pixels, before and after.
const other = path.join(out, `report-${phase === 'after' ? 'before' : 'after'}.json`)
if (fs.existsSync(other)) {
  const theirs = new Map(JSON.parse(fs.readFileSync(other, 'utf8')).map(r => [r.file, r]))
  for (const mine of report.filter(r => r.view === 'control' && r.digest)) {
    const t = theirs.get(mine.file)
    if (!t?.digest) { console.log(`· control ${mine.file}: no counterpart to compare`); continue }
    const same = t.digest.markup === mine.digest.markup && t.digest.styles === mine.digest.styles && t.png === mine.png
    console.log(`${same ? '✓' : '✗'} control ${mine.file}: markup ${t.digest.markup === mine.digest.markup ? '=' : '≠'} styles ${t.digest.styles === mine.digest.styles ? '=' : '≠'} pixels ${t.png === mine.png ? '=' : '≠'}`)
    if (!same) failures++
  }
}
console.log(`${report.filter(r => !r.problems?.length).length} captured, ${failures} refused/changed → ${out}`)
process.exit(failures ? 1 : 0)
