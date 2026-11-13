import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 🛑 THE FORMAT HUB'S STATS SIT ON THE ART, AND THE ART IS LIT ON ONE SIDE.
 *
 * The hero body's only veil ran sideways and thinned to 40% by 70% of the width. On a phone the four
 * stats spread across the whole row, so the last two sat on the bright half: measured on the Guilly
 * hero (2026-11-07), "You commission" was 1.7:1 and "At risk this week" 2.5:1 — under the 4.5:1 floor
 * for 11px labels. One component draws all six hubs (zombie, tournament, survivor, c2c, guillotine,
 * efl), so every hub had it.
 *
 * The fix layers a bottom-up scrim OVER that veil. These checks pin the layer, its order, and enough
 * opacity at the stats band; the on-screen numbers (6.7–7.3:1 after) are in the PR.
 */
const css = readFileSync(path.join(process.cwd(), 'components/core-app/af-format-hubs.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))

function body(selector: string): string {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no rule ${selector}`)
  const before = css.slice(0, at)
  if (before.split('{').length !== before.split('}').length) throw new Error(`${selector} is nested`)
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

describe('the format hub hero', () => {
  const rule = body('.af-core .afh-hero-body')
  const background = /background:\s*([\s\S]*?);/.exec(rule)?.[1] ?? ''
  const layers = background.split(/,\s*(?=linear-gradient)/)

  it('lays a bottom-up scrim over the sideways veil', () => {
    expect(layers).toHaveLength(2)
    // CSS paints the FIRST layer on top: the scrim has to come first.
    expect(layers[0]).toMatch(/^linear-gradient\(to top,/)
    expect(layers[1]).toMatch(/^linear-gradient\(100deg,/)
  })

  it('is dark where the stats sit and clear above them', () => {
    const stops = [...layers[0].matchAll(/rgba\(6, 7, 15, ([\d.]+)\) (\d+)%/g)].map((m) => ({ alpha: Number(m[1]), at: Number(m[2]) }))
    expect(stops[0]).toEqual({ alpha: expect.any(Number), at: 0 })
    expect(stops[0].alpha).toBeGreaterThanOrEqual(0.85)
    // The stats band (labels to the eyebrow) reaches ~30% up the body on a phone.
    const band = stops.find((s) => s.at >= 25 && s.at <= 40)
    expect(band?.alpha).toBeGreaterThanOrEqual(0.7)
    // …and it fades out, so the art above the stats is not blacked out.
    expect(stops[stops.length - 1].alpha).toBe(0)
    expect(stops[stops.length - 1].at).toBeLessThanOrEqual(65)
  })
})
