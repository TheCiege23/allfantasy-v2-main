/**
 * The league rail does not render text below 11px.
 *
 * 🛑 IT RENDERED AT 7px, ON EVERY /core SCREEN. Measured on production 2026-09-28 with the rail
 * open and 57 leagues loaded: 132 elements at 7px, of which `af-rail-row-labels` (the SCORE/PROJ
 * header) accounted for 88 and `af-rail-row-fresh` 44, with team names and projections at 10px.
 * The mobile-gui P1 audit had already set 11px as this app's floor when it raised the phone
 * tab-bar labels from 9.5px; the rail was never part of that pass.
 *
 * ⚠ 11px WAS CHOSEN BY MEASUREMENT, NOT BY TASTE. The change was applied to the LIVE rail first
 * and the layout measured before and after, at 1024 (rail, 300px wide) and at 375 (full-width
 * tray):
 *     labels / fresh / projected clipped   0 -> 0      at both widths
 *     team names clipped (ellipsis)       12 -> 17     of 101, desktop;  2 -> 2 on phone
 *     rail overflow / page overflow        none -> none at both widths
 * So the only cost is five more long team names hitting the ellipsis they already use.
 *
 * ⚠ THIS GUARDS THE RAIL, NOT THE APP. There are ~510 sub-11px font declarations across
 * components/core-app; raising all of them is a design decision, not a patch. This pins the one
 * surface that was measured, on every screen, so it cannot quietly slide back.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'components/core-app/af-core-shell.css'), 'utf8')
  // prose about a font size is not a font size — this repo has shipped a guard satisfied by its
  // own explanatory comment before (see reduced-motion-coverage).
  .replace(/\/\*[\s\S]*?\*\//g, '')

const FLOOR_PX = 11

/** Rail rules whose text a reader has to actually read. */
const RULES = [
  '.af-core .af-rail-row-labels',
  '.af-core .af-rail-row-fresh',
  '.af-core .af-rail-row-team',
  '.af-core .af-rail-row-projected',
]

/** Every `font:`/`font-size:` px value declared inside one rule block. */
function sizesIn(selector: string): number[] {
  const out: number[] = []
  let from = 0
  for (;;) {
    const i = CSS.indexOf(selector + ' {', from)
    if (i === -1) break
    const j = CSS.indexOf('}', i)
    const block = CSS.slice(i, j)
    for (const m of block.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?([\d.]+)px/g)) out.push(parseFloat(m[1]))
    from = j
  }
  return out
}

describe('the league rail keeps an 11px type floor', () => {
  it('finds the rules at all — a renamed selector would pass every assertion below', () => {
    for (const rule of RULES) expect(sizesIn(rule).length, `${rule} declares no px font size`).toBeGreaterThan(0)
  })

  for (const rule of RULES) {
    it(`${rule} declares nothing under ${FLOOR_PX}px`, () => {
      const sizes = sizesIn(rule)
      const under = sizes.filter((s) => s < FLOOR_PX)
      expect(under, `${rule} declares ${under.join('px, ')}px — below the ${FLOOR_PX}px floor`).toEqual([])
    })
  }
})
