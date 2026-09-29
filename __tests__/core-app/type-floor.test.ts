/**
 * No stylesheet under components/ or app/ declares a font size below 11px.
 *
 * 11px IS THIS APP'S FLOOR, set by the mobile-gui P1 audit when it raised the phone tab-bar
 * labels from 9.5px. The rail followed (rail-type-floor.test.ts). This sweep finished the CSS:
 * 805 declarations across 88 files, from {10px: 356, 9px: 197, 10.5px: 105, 9.5px: 91, 8px: 37,
 * 8.5px: 15, 7px: 3, 7.5px: 1}.
 *
 * ⚠ IT WAS MEASURED ON THE LIVE SITE BEFORE IT WAS WRITTEN, not reasoned about. Every element
 * whose COMPUTED size was under 11px was bumped inline and the page re-measured — so the numbers
 * below cover Tailwind-driven text as well as these stylesheets, because the probe read computed
 * style and did not care where the size came from:
 *
 *              page                 bumped  truncating  page overflow  doc height
 *   1280px     /core                  300     5 -> 5       0 -> 0        +0.4%
 *              /core/trades           276     1 -> 1       0 -> 0        +0.6%
 *              /core/standings        194     2 -> 2       0 -> 0        +0.8%
 *    375px     /core                  300    13 -> 13      0 -> 0        +0.8%
 *              /core/trades           276    13 -> 12      0 -> 0        +1.3%
 *              /core/players           46     1 -> 1       0 -> 0        +0.3%
 *              /core/career            43     1 -> 2       0 -> 0         +0%
 *
 * One additional ellipsis on /core/career at phone width is the entire measured cost. Nothing
 * overflowed its container or the page at either width.
 *
 * 🛑 WHAT THIS GUARD DOES **NOT** COVER, stated so a green run is not read as "the app has an
 * 11px floor" — it does not, yet:
 *   - Tailwind arbitrary sizes. `text-[10px]` alone appears 3,839 times, plus 989 `text-[9px]`,
 *     266 `text-[8px]` and 49 `text-[7px]` across 777 files. That is the DOMINANT surface and
 *     it is a separate change; extend this guard to cover it once that lands.
 *   - Inline `fontSize` props in TSX (19 remain). The ones that render as ordinary DOM text were
 *     raised with this sweep; the rest are deliberately exempt, see below.
 *   - `public/railway-styles.css`. Served but DELIBERATELY UNREFERENCED — its
 *     `<link href="/railway-styles.css">` was removed from app/layout.tsx and
 *     root-language-provider-layout.test.tsx asserts it stays removed, so its sizes never render.
 *     Rewriting 100KB+ of a stylesheet no page loads is churn.
 *
 * 🛑 AND TWO KINDS OF SURFACE WHERE A px FLOOR IS THE WRONG RULE, both left alone on measurement:
 *   - A USER-ZOOMABLE SCALED CANVAS. `BracketTreeView` renders its 1236px bracket at
 *     `zoom = 0.55` by default (pinch 0.3-3.0, with a live % readout) and `BracketProView` at
 *     `transform: scale(...)`. Declared px is not rendered px there: at 0.55 a declared 10px
 *     paints at 5.5px, so raising the declaration to 11px buys 6.05px while breaking a fixed
 *     120x36 cell whose SVG connectors are drawn at computed absolute coordinates. The zoom
 *     control IS the legibility mechanism on that surface.
 *   - A FIXED-CANVAS GRAPHIC. `components/career/ShareCard.tsx` is a 620x780 poster rendered by
 *     React DOM for preview and by satori for the PNG export. Its 10px is composition inside a
 *     scaled image, not body text at device width, and changing it changes an exported asset.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const FLOOR_PX = 11

/** Tracked stylesheets under the two roots this sweep covered. */
const SHEETS = execFileSync('git', ['ls-files', 'components/**/*.css', 'app/**/*.css'], {
  cwd: process.cwd(),
  encoding: 'utf8',
})
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

/**
 * `font-size: 9px` and the size token of the `font:` shorthand (`font: 700 9px/1 X`).
 * Values inside clamp()/calc()/min()/max() are ramp bounds rather than a floor and are skipped —
 * all 11 such uses in this repo have minimums at or above 15px anyway.
 */
const DECL = /font(?:-size)?:\s*(?:[^;{}]*?\s)?(\d+(?:\.\d+)?)px/g
const FUNCTIONAL = /font-size:\s*(?:clamp|calc|min|max)\(/

/**
 * Prose about a font size is not a font size. This repo has shipped a guard satisfied by its own
 * explanatory comment before (reduced-motion-coverage), and the sweep's own rewriter deliberately
 * left comments byte-identical — so a comment saying "the 10px line" must not read as a violation.
 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function sizesIn(css: string): number[] {
  const body = stripComments(css)
  const out: number[] = []
  for (const m of body.matchAll(DECL)) {
    const before = body.slice(Math.max(0, m.index - 12), m.index + m[0].length)
    if (FUNCTIONAL.test(before)) continue
    out.push(parseFloat(m[1]))
  }
  return out
}

describe(`no stylesheet declares text below ${FLOOR_PX}px`, () => {
  it('reads a real, non-trivial set of stylesheets', () => {
    // A glob that matched nothing would pass every assertion below.
    expect(SHEETS.length).toBeGreaterThan(80)
  })

  it('the matcher actually finds font sizes — and flags one below the floor', () => {
    // Positive control: the check must go red on a planted violation, or its green means nothing.
    expect(sizesIn('.a { font-size: 9px }')).toEqual([9])
    expect(sizesIn('.a { font: 700 8.5px/1 Archivo }')).toEqual([8.5])
    // ...and must not be fooled by prose, or by a responsive ramp whose minimum is already fine.
    expect(sizesIn('/* the 10px line */ .a { color: red }')).toEqual([])
    expect(sizesIn('.a { font-size: clamp(15px, 2vw, 20px) }')).toEqual([])
  })

  it('finds font sizes across the real stylesheets', () => {
    // Guards the inverse of the above: a matcher that silently matched NOTHING in the real files
    // would also report zero violations.
    const total = SHEETS.reduce((n, f) => n + sizesIn(readFileSync(join(process.cwd(), f), 'utf8')).length, 0)
    expect(total).toBeGreaterThan(500)
  })

  it('declares nothing below the floor', () => {
    const offenders: string[] = []
    for (const f of SHEETS) {
      for (const size of sizesIn(readFileSync(join(process.cwd(), f), 'utf8'))) {
        if (size < FLOOR_PX) offenders.push(`${f}: ${size}px`)
      }
    }
    expect(offenders, `below the ${FLOOR_PX}px floor:\n${offenders.join('\n')}`).toEqual([])
  })
})
