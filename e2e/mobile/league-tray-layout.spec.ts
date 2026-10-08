import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test, type Page } from "@playwright/test"

/**
 * The phone league tray must never pan sideways, and its list must scroll.
 *
 * 🛑 WHY THIS EXISTS. Reported from an iPhone on 2026-10-08: the tray looked "half full screen",
 * clipped on both edges, and would not browse. The foot's Create / Import / Profile tiles were held
 * at their nowrap text width — 466px in a 402px row — and because the tray is `overflow-y: auto`
 * (which makes x auto too) iOS panned the whole tray 50px sideways and gave swipes to that pan
 * instead of the league list. Valid CSS, nothing threw, every existing check green. Fixed in
 * af-core-shell.css (the "it must never pan sideways" block); this spec is what keeps it fixed.
 *
 * ⚠ NO DEV SERVER, NO LOGIN, NO DATABASE — AND THAT IS WHY IT CAN GATE EVERY PR. The real tray is
 * behind auth, and the signed-in phone lane (`authed-phone.spec.ts`, which also opens the real tray)
 * runs nightly only. So this renders the tray's MARKUP against the REAL stylesheets, read from disk,
 * on the same two emulated devices `mobile-smoke` uses.
 *
 * ⚠ THE MARKUP IS A COPY, SO IT IS CHECKED AGAINST ITS SOURCE. A hand-written copy of a component
 * drifts, and a drifted copy measures nothing. Every class this markup uses must still appear in
 * `AfCoreShell.tsx`; a renamed class fails the first test rather than silently turning this file
 * into a check of CSS nothing renders.
 *
 * ⚠ AND IT WAS MADE TO FAIL FIRST. Against the stylesheet as it stood before the fix (690fd957), every
 * layout test here went red on emulated Pixel 5: the tray measured 564–574px wide in a 393px viewport,
 * and 564px at 320px.
 */

const ROOT = resolve(__dirname, "../..")
const STYLESHEETS = ["components/core-app/af-core.css", "components/core-app/af-core-shell.css"]
const SHELL_SOURCE = "components/core-app/AfCoreShell.tsx"

/*
 * Tailwind's preflight is compiled into the app's global CSS and is not readable as a plain file here.
 * The tray's widths depend on exactly one thing from it — border-box sizing — so that much is restated.
 */
const PREFLIGHT = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;border:0 solid}
a{color:inherit;text-decoration:inherit}button{font:inherit;color:inherit;background:none}
img{display:block;max-width:100%}`

function side(name: string, them = false): string {
  return `<span class="af-rail-row-side"${them ? ' data-side="them"' : ""}>
    <span class="af-rail-row-av">${name[0]}</span>
    <span class="af-rail-row-team">${name}</span>
    <span class="af-rail-row-score">0.0</span>
    <span class="af-rail-row-projected">112.4</span>
    <span class="af-rail-row-projected" data-kind="af">109.7</span>
  </span>`
}

function tile(i: number): string {
  return `<a href="#l${i}" class="af-rail-tile af-platform" data-platform="sleeper" data-active="${i === 1}">
    <span class="af-rail-tile-art">AF</span>
    <span class="af-rail-row">
      <span class="af-rail-row-headline">
        <span class="af-rail-row-name">NFL Dynasty 2026 League ${i + 1}</span>
        <span class="af-rail-row-fresh">now</span>
      </span>
      <span class="af-rail-score-status">W5 scores updated 8:03 PM</span>
      <span class="af-rail-row-line">
        <span class="af-rail-row-labels"><span></span><span>SCORE</span><span>SLPR</span><span>AF</span></span>
        ${side("allfantasyreview")}
        ${side("Team 3", true)}
      </span>
    </span>
  </a>`
}

/** The tray as AfCoreShell renders it with the phone tray open. */
function trayMarkup(leagues: number, avatar: "letter" | "image"): string {
  const css = STYLESHEETS.map((p) => readFileSync(resolve(ROOT, p), "utf8")).join("\n")
  const mark =
    avatar === "image"
      ? `<img class="af-rail-tile-img" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'/%3E">`
      : "R"
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>${PREFLIGHT}\n${css}</style></head><body>
<div class="af-core af-shell" data-rail-open="true">
  <button type="button" class="af-rail-handle"><span class="af-rail-handle-mark">AF</span><span class="af-rail-handle-text">Close</span></button>
  <nav class="af-rail" id="af-rail">
    <a href="#" class="af-rail-logo">AF</a>
    <div class="af-rail-divider"></div>
    <button type="button" class="af-rail-toggle"><span class="af-rail-toggle-icon">«</span><span class="af-rail-toggle-text">${leagues} leagues · Week 5</span></button>
    <div class="af-rail-scroll" id="af-rail-scroll">${Array.from({ length: leagues }, (_, i) => tile(i)).join("")}</div>
    <div class="af-rail-foot">
      <a href="#c" class="af-rail-tile af-rail-add"><span class="af-rail-foot-icon">+</span><span class="af-rail-foot-copy"><strong>Create a league</strong><small>Build a custom league</small></span></a>
      <a href="#i" class="af-rail-tile af-rail-add"><span class="af-rail-foot-icon">↓</span><span class="af-rail-foot-copy"><strong>Import a league</strong><small>Connect a platform</small></span></a>
      <a href="#s" class="af-rail-tile af-rail-profile">${mark}<span class="af-rail-foot-copy"><strong>A very long account display name</strong><small>Profile &amp; settings</small></span></a>
    </div>
  </nav>
  <div class="af-main"><main class="af-content" id="af-content"></main></div>
</div></body></html>`
}

type TrayGeometry = {
  innerWidth: number
  innerHeight: number
  railScrollWidth: number
  railClientWidth: number
  scrollLeftAfterPan: number
  outside: string[]
  list: { scrollHeight: number; clientHeight: number; scrolledTo: number }
  footBottom: number
}

async function measure(page: Page): Promise<TrayGeometry> {
  return page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>(".af-rail")!
    const list = document.querySelector<HTMLElement>(".af-rail-scroll")!
    // A sideways swipe, done the way the browser does it: by setting scrollLeft.
    rail.scrollLeft = 200
    const scrollLeftAfterPan = rail.scrollLeft
    rail.scrollLeft = 0
    const outside: string[] = []
    const boxes = document.querySelectorAll<HTMLElement>(
      ".af-rail-logo, .af-rail-toggle, .af-rail-scroll > .af-rail-tile, .af-rail-foot > .af-rail-tile",
    )
    boxes.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      if (r.left < -0.5 || r.right > window.innerWidth + 0.5) {
        outside.push(`${el.className.split(" ").pop()}#${i} spans ${Math.round(r.left)}..${Math.round(r.right)}`)
      }
    })
    list.scrollTop = 400
    const scrolledTo = list.scrollTop
    list.scrollTop = 0
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      railScrollWidth: rail.scrollWidth,
      railClientWidth: rail.clientWidth,
      scrollLeftAfterPan,
      outside,
      list: { scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, scrolledTo },
      footBottom: document.querySelector(".af-rail-foot")!.getBoundingClientRect().bottom,
    }
  })
}

function expectNoSidewaysPan(g: TrayGeometry, where: string): void {
  expect(
    g.railScrollWidth,
    `${where}: the tray is ${g.railScrollWidth}px wide in a ${g.railClientWidth}px box, so iOS pans it sideways`,
  ).toBeLessThanOrEqual(g.railClientWidth)
  expect(g.scrollLeftAfterPan, `${where}: a sideways swipe moved the tray ${g.scrollLeftAfterPan}px`).toBe(0)
  expect(g.outside, `${where}: tray controls drawn past the screen edge`).toEqual([])
}

test.describe("@mobile league tray layout", () => {
  test("the markup under test still matches AfCoreShell", () => {
    const source = readFileSync(resolve(ROOT, SHELL_SOURCE), "utf8")
    const used = new Set<string>()
    for (const m of trayMarkup(1, "image").matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) used.add(c)
    }
    const missing = [...used].filter((c) => !source.includes(c))
    expect(missing, `classes this spec renders that ${SHELL_SOURCE} no longer uses — update the markup`).toEqual([])
  })

  for (const avatar of ["letter", "image"] as const) {
    test(`does not pan sideways (profile ${avatar})`, async ({ page }) => {
      await page.setContent(trayMarkup(3, avatar))
      await expect(page.locator(".af-rail")).toBeVisible()
      const g = await measure(page)
      expectNoSidewaysPan(g, `${g.innerWidth}px`)
      expect(g.footBottom, "the Create / Import / Profile foot is below the screen").toBeLessThanOrEqual(g.innerHeight)
    })
  }

  test("does not pan sideways on the narrowest phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await page.setContent(trayMarkup(3, "image"))
    expectNoSidewaysPan(await measure(page), "320px")
  })

  test("a long league list scrolls inside the tray", async ({ page }) => {
    await page.setContent(trayMarkup(20, "letter"))
    const g = await measure(page)
    expectNoSidewaysPan(g, `${g.innerWidth}px, 20 leagues`)
    expect(g.list.scrollHeight, "20 leagues should overflow the list box").toBeGreaterThan(g.list.clientHeight)
    expect(g.list.scrolledTo, "the league list did not scroll").toBeGreaterThan(0)
    expect(g.footBottom, "the foot must stay on screen while the list scrolls").toBeLessThanOrEqual(g.innerHeight)
  })
})
