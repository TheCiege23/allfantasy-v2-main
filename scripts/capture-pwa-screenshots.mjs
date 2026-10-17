#!/usr/bin/env node
/**
 * Regenerates the `screenshots` images referenced by public/manifest.webmanifest.
 *
 * PWABuilder's report flags a manifest with no `screenshots` as a WARNING rather
 * than an info item, and it is the one item on that report that changes what a
 * user sees: Chrome's rich install dialog on Android and desktop falls back to a
 * bare icon-and-title strip without them, and the Microsoft Store package cannot
 * be submitted without at least one.
 *
 * ⚠ THESE ARE REAL CAPTURES OF REAL PAGES, AND MUST STAY THAT WAY. A store
 * listing screenshot is a claim about what the product looks like. Hand-drawn
 * mockups in this directory would be a false one, so this script points a real
 * browser at a real deployment rather than composing anything.
 *
 * Every route captured is PUBLIC and read-only — no signed-in surface, no form
 * submitted, nothing written. That is why the default target is production: it
 * is the artifact the store listing describes, and reading our own marketing
 * pages is not the agent-tester write path that `agent-tester/preflight.ts`
 * refuses to point at production.
 *
 *   node scripts/capture-pwa-screenshots.mjs
 *   PWA_SCREENSHOT_BASE_URL=http://localhost:3000 node scripts/capture-pwa-screenshots.mjs
 *
 * After running, `--emit-manifest` prints the `screenshots` array to paste into
 * public/manifest.webmanifest if the route list here changes.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = (process.env.PWA_SCREENSHOT_BASE_URL || 'https://allfantasy.ai').replace(/\/+$/, '');
const OUT_DIR = path.join(process.cwd(), 'public', 'screenshots');
const EMIT_MANIFEST = process.argv.includes('--emit-manifest');
/** `--only=tools` captures one route — for re-shooting a single page, or checking the guards on it. */
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

/*
 * Chrome rejects a screenshot set whose members disagree on aspect ratio, and
 * caps the ratio at 2.3:1 in either direction. 1280x800 is 1.6:1 and 412x824 is
 * exactly 2:1, so both sit inside the cap with room to spare, and every member
 * of each form factor shares one ratio because one viewport produces all of it.
 *
 * `deviceScaleFactor: 1` on purpose: the manifest declares the CSS pixel size,
 * and a 2x capture would declare a size the file does not have.
 */
const FORM_FACTORS = [
  { formFactor: 'wide', width: 1280, height: 800 },
  { formFactor: 'narrow', width: 412, height: 824 },
];

/**
 * Public routes only, and chosen for what they SHOW rather than for what they
 * rank for. `/live` was captured first and dropped: signed out it renders
 * "None of your players are playing right now" over two thirds of empty page,
 * and `?scope=all` is empty too whenever no slate is running — a screenshot
 * whose content depends on the hour is not one to put in a store listing.
 *
 * `/chimmy` was dropped because signed out it stacks two headers on top of each
 * other. Worth putting back once that is fixed — it is the best single picture
 * of what the product actually does.
 *
 * The `/tools/*` pages are SEO landing copy rather than product surface — three
 * paragraphs and a button — so they photograph as text, not as an app.
 *
 * `label` becomes the manifest `label`, which is what a screen reader announces
 * in the install dialog.
 */
const ROUTES = [
  { slug: 'home', path: '/', label: 'Every league you play on one screen, with what needs you first' },
  { slug: 'tools', path: '/tools-hub', label: 'Trade analyzer, mock drafts, waiver advisor and power rankings in one hub' },
  { slug: 'pricing', path: '/pricing', label: 'Free forever for players, with paid tiers for deeper tools' },
  /*
   * `/bracket` was dropped 2026-10-01: it still leads with "2026 FIFA World Cup ·
   * Registration open" after the tournament ended, so it is out-of-date content
   * on the live site, not just in a screenshot. Put it back once that page
   * shows a current competition.
   */
];

/*
 * Fixed-position chrome is a site control, not product surface, and reads as a
 * bug in a store listing. Hidden by the hooks the components carry ON PURPOSE,
 * never by layout classes: this used to be `.fixed.right-4.z-40`, which went
 * stale when GlobalModeToggle gained a layout without `right-4`, and the
 * 2026-10-01 capture photographed the toggle on two of four pages with nothing
 * failing. Animations are stilled so two runs produce the same bytes for an
 * unchanged page.
 */
const SCREENSHOT_CSS = `
  [data-af-mode-toggle], [aria-label="Back to top"] { display: none !important; }
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const captured = [];

  try {
    for (const factor of FORM_FACTORS) {
      for (const route of ROUTES.filter((r) => !ONLY || r.slug === ONLY)) {
        /*
         * ⚠ A FRESH CONTEXT PER SHOT, AND NOT FOR TIDINESS. Sharing one context
         * across the four routes produced a Spanish screenshot set from an
         * en-US browser. Loading `/` makes Next PREFETCH the header language
         * toggle's target, `/?lang=es`; `nextWithRouteHeaders` in middleware.ts
         * cannot tell that prefetch from a navigation, so it stamps
         * `af_lang=es` on the response, and every page visited afterwards in
         * that session server-renders Spanish. Reproduced at 412px and 1280px.
         *
         * That is a live bug in the app, reported separately — this is not the
         * file that fixes it. A fresh context is what we want here regardless:
         * a store screenshot should show what a FIRST-TIME visitor sees, and a
         * context carrying four pages of accumulated cookies does not.
         */
        const context = await browser.newContext({
          viewport: { width: factor.width, height: factor.height },
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
          colorScheme: 'dark',
          /*
           * Declared so the capture states its intent, NOT because it is what
           * keeps the set in English — measured, and worth recording because
           * the obvious reading is wrong. Re-running this whole script with
           * `es-ES` in both fields still produces `lang="en"` on every page:
           * the server does not negotiate from Accept-Language at all. The
           * cookie above is the only thing that switches the language, which
           * is exactly why one prefetch can hijack a whole session.
           */
          locale: 'en-US',
          extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
        });
        const page = await context.newPage();
        const url = `${BASE_URL}${route.path}`;

        /*
         * NOT `networkidle`. This app never reaches it — it keeps long-lived
         * connections open — so waiting for it times out at 60s on a page that
         * finished painting in two. Wait for `load`, then settle explicitly.
         */
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
        await page.addStyleTag({ content: SCREENSHOT_CSS });
        await page.waitForTimeout(3_000);

        /*
         * Two assertions rather than a bare screenshot, because both failures
         * this script has actually produced are INVISIBLE to a green exit: a
         * 404 photographs as a tidy "page not found" card, and the locale bug
         * above photographs as a perfectly rendered Spanish page. Neither
         * throws. Check the status and the language the document ended up in.
         */
        const status = response?.status() ?? 0;
        if (status !== 200) {
          throw new Error(`${url} returned ${status} — a screenshot of an error page is worse than none`);
        }
        const lang = await page.evaluate(() => document.documentElement.lang);
        if (lang && !lang.toLowerCase().startsWith('en')) {
          throw new Error(`${url} rendered lang="${lang}" from an en-US browser — see the af_lang note above`);
        }

        /*
         * Two more failures that photograph cleanly and exit green:
         *
         * 1. A launch countdown ("free until Oct 15"). Time-limited promo goes
         *    stale within days and is exactly what store listings forbid. Before
         *    launch it leads the home AND pricing first screens, so this refuses
         *    to capture until launch has passed rather than shipping a set that
         *    is wrong two weeks later. Matched on the component's own testid and
         *    the banner/strip classes, not on its wording.
         * 2. Floating chrome still on screen after SCREENSHOT_CSS — any fixed
         *    element whose whole text is a theme label. Catches the next
         *    selector drift the way the old `.fixed.right-4.z-40` one was NOT.
         */
        const leaks = await page.evaluate(() => {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
          };
          const promo = [...document.querySelectorAll('[data-testid="launch-countdown"], .af-launch-banner, .af-launch-strip-main')].filter(visible);
          const chrome = [...document.querySelectorAll('body *')].filter(
            (el) => getComputedStyle(el).position === 'fixed' && /^(dark|light|system)$/i.test((el.textContent || '').trim()) && visible(el),
          );
          return { promo: promo.length, chrome: chrome.length };
        });
        if (leaks.promo > 0) {
          throw new Error(`${url} shows a launch countdown/offer (${leaks.promo}) — time-limited promo; re-run after launch`);
        }
        if (leaks.chrome > 0) {
          throw new Error(`${url} still shows ${leaks.chrome} floating theme control(s) after SCREENSHOT_CSS — the hiding selector has drifted`);
        }

        const file = `${route.slug}-${factor.formFactor}.png`;
        await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: false });
        captured.push({
          src: `/screenshots/${file}`,
          sizes: `${factor.width}x${factor.height}`,
          type: 'image/png',
          form_factor: factor.formFactor,
          label: route.label,
        });
        console.log(`captured ${file}  <- ${url}  (${status}, lang="${lang}")`);

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (EMIT_MANIFEST) {
    const json = JSON.stringify(captured, null, 2);
    console.log('\n"screenshots":', json);
    await writeFile(path.join(OUT_DIR, 'manifest-fragment.json'), `${json}\n`, 'utf8');
  }

  console.log(`\n${captured.length} screenshots written to public/screenshots/ from ${BASE_URL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
