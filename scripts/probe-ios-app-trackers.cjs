#!/usr/bin/env node
/**
 * Which ad/tracking hosts does a page contact INSIDE the iOS app? — the evidence
 * behind the App Store "Data Used to Track You" answer (docs/app-store/RUNBOOK.md).
 *
 * Loads each page twice in WebKit: once as the iOS app (its real User-Agent,
 * carrying `AllFantasyiOS/1.0`, see lib/platform/iosApp) and once as plain iPhone
 * Safari. Safari is the POSITIVE CONTROL: if it reports no tracker requests, the
 * probe is blind (a page failed to load, the pattern is stale, the pixels are off
 * everywhere) and its "0 in the app" means nothing.
 *
 * Read-only: public pages, no sign-in, no forms. Exit 1 if the app made any
 * tracker request or the control saw none.
 *
 *   node scripts/probe-ios-app-trackers.cjs [baseUrl]      # default https://www.allfantasy.ai
 *
 * Measured 2026-09-28 on production before the SafeGlobalChrome fix: Safari 20
 * tracker requests, the app 1 — the Facebook SDK, fetched through a server-rendered
 * `<link rel="preload">` on `/`, `/privacy` and `/terms` (never executed, no cookies).
 */
const { webkit } = require('playwright')

const TRACKERS =
  /facebook\.net|facebook\.com\/tr|googletagmanager|google-analytics|analytics\.google|doubleclick|tiktok|redditstatic|reddit\.com\/rp|snap\.licdn|bat\.bing/i
const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const APP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.0'
const PATHS = ['/', '/core', '/login', '/signup', '/privacy', '/terms']

async function run(browser, base, userAgent) {
  const hits = new Map()
  for (const path of PATHS) {
    // A fresh context per page, so nothing one page loaded is credited to the next.
    const ctx = await browser.newContext({ userAgent, viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    page.on('request', (r) => {
      if (!TRACKERS.test(r.url())) return
      const u = new URL(r.url())
      const key = `${u.host}${u.pathname.slice(0, 40)}`
      hits.set(key, [...new Set([...(hits.get(key) ?? []), path])])
    })
    await page.goto(base + path, { waitUntil: 'load', timeout: 60_000 }).catch((e) => {
      console.error(`  ${path}: failed to load (${e.message.slice(0, 80)})`)
    })
    await page.waitForTimeout(6_000)
    await ctx.close()
  }
  return hits
}

;(async () => {
  const base = (process.argv[2] || 'https://www.allfantasy.ai').replace(/\/$/, '')
  const browser = await webkit.launch()
  try {
    const control = await run(browser, base, SAFARI)
    const app = await run(browser, base, APP)
    console.log(`control (iPhone Safari): ${control.size} tracker endpoint(s)`)
    console.log(`iOS app:                 ${app.size} tracker endpoint(s)`)
    for (const [key, paths] of app) console.log(`  ${key}  on ${paths.join(', ')}`)
    if (control.size === 0) {
      console.error('BLIND: the Safari control saw no trackers, so the app result proves nothing.')
      process.exitCode = 1
    } else if (app.size > 0) {
      process.exitCode = 1
    }
  } finally {
    await browser.close()
  }
})()
