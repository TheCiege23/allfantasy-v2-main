/**
 * Component browser proof, without a database or Next server.
 * Bundles the real AfCoreShell and Standings components and their CSS with
 * deterministic data. Next navigation and unrelated service-backed children
 * are stubbed. This does NOT certify authenticated routes or CommsDock.
 * Uses the repository's locked esbuild (via tsx) and Playwright dependencies.
 * Run: node scripts/audits/mobile-core-browser-proof.cjs
 * Optional AF_BROWSER_EXECUTABLE points to an installed Chromium binary.
 */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../..").split(path.sep).join("/");
const proofDir = fs.mkdtempSync(
  path.join(require("os").tmpdir(), "af-mobile-proof-"),
);
const assert = require("assert/strict");
const { chromium } = require(root + "/node_modules/playwright");
const esbuild = require(root + "/node_modules/esbuild");
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import AfCoreShell from '${root}/components/core-app/AfCoreShell';
import Standings from '${root}/components/core-app/screens/Standings';
const teams=Array.from({length:12},(_,i)=>({rosterId:String(i),name:i===0?'The Very Long Championship Team Name':'Team '+i,isYou:i===0,rank:i+1,pointsFor:450-i*10,average:150-i*3,weeksPlayed:3,wins:2,losses:1,movement:1}));
const data={available:true,league:{id:'fixture',name:'Mobile Test League',platform:'sleeper'},season:2026,week:3,seasonComplete:false,teams,you:teams[0],trend:[],recent:[],projection:{available:false,reason:'Too early'},scoredWeeks:3,history:teams.map((t,i)=>({...t,season:2025,teamKey:String(i),ties:0,pointsAgainst:400}))};
const leagues=Array.from({length:20},(_,i)=>({id:String(i),name:'Test Dynasty League '+i,platform:'sleeper',mark:'L'+i}));
createRoot(document.getElementById('root')).render(<AfCoreShell active="standings" leagues={leagues} syncAge={{label:'just now',stale:false}} syncEligibleCount={0} selectedLeagueId="0"><Standings data={data}/></AfCoreShell>);`;
const empty =
  "export default function Empty(){return null}; export const GeoRestrictionNotice=Empty; export const GameDayAlertsBanner=Empty";
async function main() {
  await esbuild.build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    bundle: true,
    outfile: path.join(proofDir, "app.js"),
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "fixture-boundaries",
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (a) => ({
            path: a.path,
            namespace: "stub",
          }));
          b.onResolve({ filter: /^@\// }, (a) => {
            if (
              /(CommsDock|SyncNowButton|GeoRestrictionNotice|GameDayAlertsBanner|MiniPlayerImg|PlayerCardProvider)$/.test(
                a.path,
              )
            )
              return { path: a.path, namespace: "stub" };
            return b.resolve(path.join(root, a.path.slice(2)), {
              resolveDir: root,
              kind: a.kind,
            });
          });
          b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
            contents:
              a.path === "next/link"
                ? `import React from '${root}/node_modules/react'; export default function Link({href,children,prefetch,...props}){return React.createElement('a',{href,...props},children)}`
                : a.path === "next/navigation"
                  ? "export const useRouter=()=>({push(){},replace(){},prefetch(){}});"
                  : a.path.endsWith("PlayerCardProvider")
                    ? "export default function Provider({children}){return children}"
                    : empty,
            loader: "js",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const html =
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
  const server = require("http").createServer((req, res) => {
    if (req.url === "/app.js" || req.url === "/app.css") {
      res.setHeader(
        "Content-Type",
        req.url.endsWith(".css") ? "text/css" : "text/javascript",
      );
      res.end(fs.readFileSync(path.join(proofDir, req.url.slice(1))));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const args =
      process.env.AF_BROWSER_SINGLE_PROCESS === "1"
        ? [
            "--no-sandbox",
            "--disable-gpu",
            "--no-zygote",
            "--single-process",
            "--use-gl=disabled",
            "--disable-software-rasterizer",
          ]
        : [];
    browser = await chromium.launch({
      executablePath: process.env.AF_BROWSER_EXECUTABLE || undefined,
      args,
    });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator(".af-st-table").waitFor();
      const before = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 2,
        bar: document
          .querySelector(".af-tabbar")
          .getBoundingClientRect()
          .toJSON(),
        handle: document
          .querySelector(".af-rail-handle")
          .getBoundingClientRect()
          .toJSON(),
        labels: [...document.querySelectorAll(".af-tabbar-label")].map((e) => ({
          text: e.textContent,
          size: getComputedStyle(e).fontSize,
          overflow: e.scrollWidth > e.clientWidth,
        })),
      }));
      assert.equal(before.overflow, false, `${width}px document overflow`);
      assert(
        before.handle.bottom <= before.bar.top,
        `${width}px handle overlaps bar`,
      );
      assert(
        before.labels.every((l) => parseFloat(l.size) >= 11 && !l.overflow),
        "labels clipped",
      );
      for (const selector of [".af-st-tablewrap", ".af-st-history-scroll"]) {
        const scroll = page.locator(selector);
        await scroll.scrollIntoViewIfNeeded();
        const result = await scroll.evaluate((e) => {
          const th = e.querySelector("tbody th");
          const original = th.getBoundingClientRect().left;
          e.scrollLeft = 200;
          return {
            original,
            left: e.getBoundingClientRect().left,
            sticky: th.getBoundingClientRect().left,
            scroll: e.scrollLeft,
            width: e.clientWidth,
            full: e.scrollWidth,
          };
        });
        assert(result.scroll > 0, `${selector} scrolls`);
        assert(
          Math.abs(
            Math.max(result.left + 1, result.original - result.scroll) -
              result.sticky,
          ) < 3,
          `${selector} sticky team: ${JSON.stringify(result)}`,
        );
      }
      await page
        .getByRole("button", { name: "Open leagues", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".af-rail")).transform ===
          "none",
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .locator(".af-rail-logo")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "Close leagues", exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      assert.equal(
        await page.locator(".af-main").evaluate((e) => e.inert),
        true,
      );
      await page
        .locator(".af-rail-scroll")
        .evaluate((e) => (e.scrollTop = e.scrollHeight));
      const last = await page.locator(".af-rail-scroll a").last().boundingBox();
      const close = await page.locator(".af-rail-handle").boundingBox();
      assert(last.y + last.height <= close.y, "last league overlaps close");
      await page.screenshot({ path: path.join(proofDir, `tray-${width}.png`) });
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator(".af-main").evaluate((e) => e.inert),
        false,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Open leagues", exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      await page.locator(".af-st-tablewrap").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(proofDir, `standings-${width}.png`),
      });
      console.log(JSON.stringify({ width, ...before, status: "passed" }));
    }

    // Crossing the breakpoint releases modality and leaves focus on a visible control.
    await page
      .getByRole("button", { name: "Open leagues", exact: true })
      .click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => !document.querySelector(".af-main").inert);
    assert(
      await page
        .locator(".af-rail-toggle")
        .evaluate((e) => e === document.activeElement),
      "desktop focus restoration",
    );
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForFunction(
      () =>
        document
          .querySelector(".af-rail-handle")
          .getAttribute("aria-expanded") === "false",
    );
    assert.equal(
      await page.locator(".af-main").evaluate((e) => e.inert),
      false,
    );
    assert.deepEqual(pageErrors, []);
    console.log("Breakpoint transition passed. Screenshots: " + proofDir);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
