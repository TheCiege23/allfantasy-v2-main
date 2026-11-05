#!/usr/bin/env node
/**
 * Screenshots of the /core Trades hub's league trade evaluator (app/e2e/trade-evaluator), with the
 * roster read answered by SAMPLE data — four made-up managers, each with players, picks and a
 * generated avatar. Never runs against production.
 *
 *   node scripts/trade-evaluator-capture.mjs --base-url http://localhost:3000 --out <dir> [--modes light,dark]
 *
 * For each mode and width it captures the evaluator as it opens (Team A loaded, Team B unchosen),
 * then Team B after choosing its manager, then after adding one asset to each side, then the
 * action row. Each is a viewport screenshot, scrolled to that part of the evaluator.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
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
const modes = (arg('modes') ?? 'light,dark').split(',').map((s) => s.trim()).filter(Boolean)
const WIDTHS = { desktop: { width: 1440, height: 1000 }, tablet: { width: 820, height: 1100 }, phone: { width: 390, height: 844 } }

/** A sample avatar: the manager's initial on a colour, as an SVG data URI. */
function avatar(initial, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="${color}"/><text x="32" y="41" font-family="Arial" font-size="28" font-weight="700" text-anchor="middle" fill="#fff">${initial}</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
const p = (id, name, position, team, value) => ({ id, name, position, team, value, imageUrl: null, byeWeek: null, injuryStatus: null, stock: null, stockDelta: null })
const pick = (pickId, season, round, value) => ({ pickId, season, round, label: `${season} Round ${round}`, itemType: 'future_pick', value })
const roster = (rosterId, ownerName, color, players, picks, w, l) => ({
  rosterId, platformUserId: `u-${rosterId}`, players, picks, teamExternalId: `t-${rosterId}`, ownerName,
  avatarUrl: avatar(ownerName.slice(0, 1), color), wins: w, losses: l, ties: 0, faabRemaining: 100, canReceiveProposal: false,
})
const ROSTERS = {
  rosters: [
    roster('r1', 'Ciege Squad', '#0f766e', [
      p('p1', 'Puka Nacua', 'WR', 'LAR', 7800), p('p2', 'Bijan Robinson', 'RB', 'ATL', 8900), p('p3', 'Jordan Love', 'QB', 'GB', 4100),
      p('p4', 'Sam LaPorta', 'TE', 'DET', 4300), p('p5', 'Rashid Shaheed', 'WR', 'NO', 1500),
    ], [pick('pk1', 2027, 1, 3200), pick('pk2', 2027, 2, 1600)], 6, 3),
    roster('r2', 'Gridiron Ghosts', '#7c3aed', [
      p('p6', 'Garrett Wilson', 'WR', 'NYJ', 6200), p('p7', 'Jahmyr Gibbs', 'RB', 'DET', 8400), p('p8', 'Brock Bowers', 'TE', 'LV', 6900),
      p('p9', 'Kyle Monangai', 'RB', 'CHI', 1981), p('p10', 'C.J. Stroud', 'QB', 'HOU', 5200),
    ], [pick('pk3', 2027, 1, 3100)], 5, 4),
    roster('r3', 'Broncos', '#ea580c', [
      p('p11', 'Jonathon Brooks', 'RB', 'CAR', 1361), p('p12', 'Drake London', 'WR', 'ATL', 6600), p('p13', 'Kyler Murray', 'QB', 'ARI', 3800),
    ], [pick('pk4', 2028, 1, 2900)], 4, 5),
    roster('r4', 'Paul Brown', '#2563eb', [
      p('p14', 'Kamari Lassiter', 'DB', 'HOU', 329), p('p15', 'Tee Higgins', 'WR', 'CIN', 5100), p('p16', 'Trey McBride', 'TE', 'ARI', 5900),
    ], [], 7, 2),
  ],
  viewerRosterId: null,
  viewerTeamRosterId: 'r1',
  pickCoverage: 'complete',
}

async function answerApi(route) {
  const url = new URL(route.request().url())
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (/\/api\/leagues\/[^/]+\/trades\/rosters$/.test(url.pathname)) return json(200, ROSTERS)
  if (url.pathname === '/api/league/trades-panel') return json(200, { activeTrades: [], historyTrades: [], pendingOffers: [], pending: { scanned: true, reason: null, platform: 'sleeper', leagueUrl: null, weeksUnanswered: 0 } })
  return json(404, {})
}

fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: arg('chromium') || process.env.AF_CAPTURE_CHROMIUM || undefined })
let failures = 0
try {
  for (const mode of modes) {
    const context = await browser.newContext({ deviceScaleFactor: 1 })
    await context.addCookies([{ name: 'af_mode', value: mode, url: baseUrl }])
    await context.route('**/api/**', answerApi)
    const page = await context.newPage()
    for (const [label, viewport] of Object.entries(WIDTHS)) {
      await page.setViewportSize(viewport)
      await page.goto(`${baseUrl}/e2e/trade-evaluator`, { waitUntil: 'load', timeout: 240_000 })
      const evaluator = page.locator('.af-tc-hub-evaluator')
      await evaluator.waitFor({ state: 'visible', timeout: 120_000 })
      await page.locator(".af-tc-hub-evaluator .af-tc-team[data-side='give'] .af-tc-roster").first().waitFor({ timeout: 60_000 })
      await page.evaluate(() => document.fonts?.ready)
      /*
       * VIEWPORT shots, scrolled to a part of the evaluator, not crops of the section: a crop drops
       * the page's own padding and paints the pinned balance bar wherever the capture happened to
       * be scrolled, which once made a fine header look flush to the screen edge.
       */
      const shot = async (step, anchor = '.af-tc-hub-evaluator') => {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel)
          if (!el) throw new Error(`no ${sel}`)
          // INSTANT: the shell scrolls smoothly, and a shot taken mid-animation lands short.
          el.scrollIntoView({ block: 'start', behavior: 'instant' })
          // Clear the pinned bars at the top of the viewport.
          window.scrollBy({ top: -120, behavior: 'instant' })
        }, anchor)
        await page.waitForTimeout(400)
        const file = path.join(out, `evaluator-${step}-${mode}-${label}.png`)
        await page.screenshot({ path: file })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        console.log(`${overflow > 0 ? 'OVERFLOW ' + overflow + 'px ' : ''}${file}`)
        if (overflow > 0) failures++
      }
      await shot('1-open')
      await evaluator.locator('.af-tc-partner-select select').selectOption({ label: /Gridiron Ghosts/ }).catch(async () => {
        const value = await evaluator.locator('.af-tc-partner-select option', { hasText: 'Gridiron Ghosts' }).getAttribute('value')
        await evaluator.locator('.af-tc-partner-select select').selectOption(value)
      })
      await page.locator(".af-tc-hub-evaluator .af-tc-team[data-side='get'] .af-tc-roster").first().waitFor({ timeout: 30_000 })
      await shot('2-manager-chosen', ".af-tc-hub-evaluator .af-tc-team[data-side='get']")
      await evaluator.getByLabel('Add Puka Nacua').first().click()
      await evaluator.getByLabel('Add Jahmyr Gibbs').first().click()
      await shot('3-deal-built', ".af-tc-hub-evaluator .af-tc-team[data-side='get']")
      await shot('4-actions', '.af-tc-hub-evaluator .af-tc-actions')
    }
    await context.close()
  }
} finally {
  await browser.close()
}
if (failures) {
  console.error(`${failures} frame(s) overflowed horizontally`)
  process.exit(1)
}
