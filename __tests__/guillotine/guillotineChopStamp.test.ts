/**
 * The chop moment (2026-11-06): the CHOPPED stamp, the slash and the dropped blade land on the chopped
 * team's AVATAR, never on its name or score. Before, the stamp's wrapper filled the whole card (`inset: 0`,
 * centred), so it covered 100% of the name box at 820 and 1440px and 72% at 390, and the slash ran through
 * the card's middle — the one team the moment is about could not be read.
 *
 * Geometry by arithmetic, from the same CSS the browser reads: the "avatar zone" is the card's top padding
 * plus the avatar (GuillotineChopMoment renders it at size 56), and the name starts below it. Checked at the
 * default size and inside the `@container (max-width: 640px)` block.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'components/guillotine/guillotine-specialty.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const TSX = readFileSync(join(process.cwd(), 'components/guillotine/GuillotineSpecialtyHome.tsx'), 'utf8')

/** Split into the top level and the body of the one 640px container block, by brace depth. */
function split(css: string) {
  const at = css.indexOf('@container (max-width: 640px)')
  expect(at, 'no 640px container block').toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) { end = i; break }
  }
  return { top: css.slice(0, at) + css.slice(end + 1), narrow: css.slice(open + 1, end) }
}
const { top, narrow } = split(CSS)

function decls(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = [...css.matchAll(new RegExp(`(?:^|[};])\\s*${esc}\\s*\\{([^}]*)\\}`, 'gm'))].map((m) => m[1])
  return found.join(';')
}
function px(d: string, name: string): number | null {
  const m = d.match(new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*(-?[\\d.]+)px`))
  return m ? Number(m[1]) : null
}
function paddingTop(d: string): number | null {
  const m = d.match(/(?:^|;|\s)padding\s*:\s*([\d.]+)px/)
  return m ? Number(m[1]) : null
}
const translateY = (d: string) => Number(d.match(/translateY\((-?[\d.]+)px\)/)?.[1] ?? NaN)

// Size of the chop card's avatar, read from the component so the two cannot drift apart.
const AVATAR = Number(TSX.match(/<Avatar id=\{b\.rosterId\} name=\{b\.name\} size=\{(\d+)\} \/>/)?.[1] ?? NaN)
/** The blade SVG's viewBox is 200×110, drawn at the blade's width. */
const BLADE_RATIO = 110 / 200

const sizes = [
  { label: 'default', css: top, fallback: top },
  { label: 'narrow (≤640px container)', css: narrow, fallback: top },
]

describe.each(sizes)('the chop lands on the avatar, $label', ({ css, fallback }) => {
  const pick = (sel: string, fn: (d: string) => number | null) => fn(decls(css, sel)) ?? fn(decls(fallback, sel))
  const zone = () => {
    const pad = pick('.card', paddingTop)
    expect(pad, 'card padding').not.toBeNull()
    expect(AVATAR, 'avatar size').toBeGreaterThan(0)
    return pad! + AVATAR
  }

  it('the stamp is confined to the avatar zone, not centred on the whole card', () => {
    const wrap = decls(top, '.stampWrap')
    expect(wrap).not.toMatch(/inset\s*:\s*0\s*[;}]?/)
    expect(wrap).toMatch(/(?:^|;|\s)top\s*:\s*0(?:px)?\s*;/)
    const h = pick('.stampWrap', (d) => px(d, 'height'))
    expect(h, 'stamp zone height').not.toBeNull()
    expect(h!).toBeLessThanOrEqual(zone())
  })

  it('the slash cuts through the avatar, above the name', () => {
    expect(decls(top, '.slash')).not.toMatch(/top\s*:\s*50%/)
    const t = pick('.slash', (d) => px(d, 'top'))
    expect(t, 'slash top').not.toBeNull()
    expect(t!).toBeLessThan(zone())
  })

  it('the dropped blade stops above the name', () => {
    const bladeTop = pick('.blade', (d) => px(d, 'top'))!
    const bladeWidth = pick('.blade', (d) => px(d, 'width'))!
    const drop = translateY(decls(css, '.chopped .blade') || decls(fallback, '.chopped .blade'))
    expect(Number.isFinite(drop)).toBe(true)
    expect(bladeTop + drop + bladeWidth * BLADE_RATIO).toBeLessThanOrEqual(zone())
  })
})
