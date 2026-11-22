/**
 * WCAG contrast of the redraft identity, measured from the SHIPPED files — the sport blocks in
 * components/league/native/redraft-identity.css, the grounds in components/core-app/af-core.css and
 * the background art under public/artwork/redraft/ — not from a copy of their values here.
 *
 * Grounds per mode (dark, light, and AF, which inherits the dark sport palette):
 *   card grounds:  --surface, --surface2, --bg, and the sport's -soft tint over each of them
 *   page ground:   --bg under the hero wash (--rd-glow at its focal point), under every fill in the
 *                  sport's art, under each stroke — the worst pixel on the page
 * Requirements (4.5:1, WCAG 1.4.3 normal text):
 *   --rd-accent-text on every card ground and on the page ground
 *   --text, --text2, --muted, --faint on the page ground (the art must never cost text contrast)
 *   --rd-accent-ink on --rd-accent (filled chips and buttons)
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REDRAFT_SPORT_THEMES } from '@/lib/league-media/redraftIdentity'

type RGB = [number, number, number]
const MIN = 4.5

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function hex(h: string): RGB {
  const v = h.replace('#', '')
  const full = v.length === 3 ? v.split('').map(c => c + c).join('') : v
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255) as RGB
}
function rgba(s: string): { rgb: RGB; a: number } {
  const m = s.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/)
  if (!m) throw new Error(`not an rgba(): ${s}`)
  return { rgb: [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255], a: Number(m[4]) }
}
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const over = (fg: RGB, a: number, bg: RGB): RGB => fg.map((c, i) => c * a + bg[i] * (1 - a)) as RGB

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out[m[1]] = m[2].trim()
  return out
}

const CORE = stripComments(read('components/core-app/af-core.css'))
function coreBlock(selectorRe: RegExp): Record<string, string> {
  const m = CORE.match(selectorRe)
  if (!m) throw new Error(`af-core block not found: ${selectorRe}`)
  return tokens(m[1])
}
const DARK = coreBlock(/(?:^|\n)\.af-core \{([^}]*)\}/)
const LIGHT = { ...DARK, ...coreBlock(/html\[data-mode='light'\] \.af-core \{([^}]*)\}/) }
const AF = { ...DARK, ...coreBlock(/html\[data-mode='af'\] \.af-core \{([^}]*)\}/) }

const RD = stripComments(read('components/league/native/redraft-identity.css'))
function sportBlock(sport: string, light: boolean): Record<string, string> {
  const prefix = light ? String.raw`html\[data-mode='light'\] ` : String.raw`(?:^|\n)`
  // Both roots — the /league workspace and the /core shell — read the same block (`:is(...)`).
  const re = new RegExp(`${prefix}\\.af-core:is\\(\\.nl-workspace,\\.af-shell\\)\\[data-format=redraft\\]\\[data-sport=${sport}\\]\\{([^}]*)\\}`)
  const m = RD.match(re)
  if (!m) throw new Error(`redraft-identity.css has no ${light ? 'light' : 'dark'} block for ${sport}`)
  return tokens(m[1])
}

/** Every (colour, opacity) the art paints with, read off its presentation attributes. */
function artInks(svg: string) {
  const strokes: Array<{ rgb: RGB; a: number }> = []
  const fills: Array<{ rgb: RGB; a: number }> = []
  for (const m of svg.matchAll(/stroke="(#[0-9a-fA-F]{3,6})"[^>]*?stroke-opacity="([\d.]+)"/g)) strokes.push({ rgb: hex(m[1]), a: Number(m[2]) })
  for (const m of svg.matchAll(/fill="(#[0-9a-fA-F]{3,6})"[^>]*?fill-opacity="([\d.]+)"/g)) fills.push({ rgb: hex(m[1]), a: Number(m[2]) })
  // Every colour the art paints must carry an explicit opacity the parser above read; a bare
  // stroke="#…" (full opacity) or an inline style would be invisible to this test.
  const painted = [...svg.matchAll(/(?:stroke|fill)="(#[0-9a-fA-F]{3,6})"/g)].length
  if (painted !== strokes.length + fills.length) throw new Error(`art has ${painted} inks, parsed ${strokes.length + fills.length}`)
  if (/style=|<style|opacity="(?![\d.]+")/.test(svg) || /\sopacity="/.test(svg)) throw new Error('art uses an opacity form this test does not model')
  return { strokes, fills }
}
const artUrl = (block: Record<string, string>) => block['--rd-art']?.match(/url\('([^']+)'\)/)?.[1] ?? ''

type Mode = { name: string; core: Record<string, string>; light: boolean }
const MODES: Mode[] = [
  { name: 'dark', core: DARK, light: false },
  { name: 'light', core: LIGHT, light: true },
  { name: 'af', core: AF, light: false },
]

/** The minimum ratio of `fg` over every ground, with the ground that produced it. */
function worst(fg: RGB, grounds: Array<[string, RGB]>): { ratio: number; on: string } {
  return grounds.map(([on, g]) => ({ ratio: contrast(fg, g), on })).sort((x, y) => x.ratio - y.ratio)[0]
}

function measure(sport: string, mode: Mode) {
  const rd = sportBlock(sport, mode.light)
  const soft = rgba(rd['--rd-accent-soft'])
  const accent = hex(rd['--rd-accent'])
  const bg = hex(mode.core['--bg'])
  const surface = hex(mode.core['--surface'])
  const surface2 = hex(mode.core['--surface2'])
  const elev = over(accent, 0.05, surface) // --rd-surface-elev: color-mix(accent 5%, surface)
  const cards: Array<[string, RGB]> = [
    ['--surface', surface], ['--surface2', surface2], ['--bg', bg], ['--rd-surface-elev', elev],
    ['-soft over --surface', over(soft.rgb, soft.a, surface)],
    ['-soft over --surface2', over(soft.rgb, soft.a, surface2)],
    ['-soft over --bg', over(soft.rgb, soft.a, bg)],
  ]
  const svg = read(join('public', artUrl(rd)))
  const glowInk = rgba(rd['--rd-glow'])
  // The hero wash at full strength (its focal point), then every area FILL in the art stacked on it
  // (fills are areas and can sit under a line), then each STROKE on top of that, one at a time.
  // Strokes are not stacked: two lines only overlap at a crossing, a point smaller than a glyph stem.
  const glow = over(glowInk.rgb, glowInk.a, bg)
  const { strokes, fills } = artInks(svg)
  const filled = fills.reduce((g, f) => over(f.rgb, f.a, g), glow)
  const page: Array<[string, RGB]> = [
    ['page ground (glow only)', glow],
    ['page ground (glow + fills)', filled],
    ...strokes.map(({ rgb, a }, i): [string, RGB] => [`page ground under art stroke #${i}`, over(rgb, a, filled)]),
  ]
  return { rd, accent, cards, page, strokes }
}

describe('redraft identity — contrast evaluator controls', () => {
  it('reproduces known ratios (black/white 21, #777 on white ~4.48)', () => {
    expect(contrast(hex('#000000'), hex('#ffffff'))).toBeCloseTo(21, 5)
    expect(contrast(hex('#777777'), hex('#ffffff'))).toBeCloseTo(4.48, 2)
  })
  it('FAILS a known-bad pair: the dark NFL green as light-mode text', () => {
    expect(worst(hex('#3ddc84'), [['white', hex('#ffffff')]]).ratio).toBeLessThan(MIN)
  })
  it('FAILS a known-bad art: a stroke at the mock\'s 12% costs --faint its contrast in light mode', () => {
    const faint = hex(LIGHT['--faint'])
    const loud = over(hex('#136a3a'), 0.12, hex(LIGHT['--bg']))
    expect(contrast(faint, loud)).toBeLessThan(MIN)
  })
  it('reads every ink in an art file (a parser that found none would pass every page check)', () => {
    for (const sport of REDRAFT_SPORT_THEMES) {
      for (const mode of MODES) {
        expect(measure(sport, mode).strokes.length, `${sport}/${mode.name}`).toBeGreaterThan(0)
      }
    }
  })
})

describe.each(REDRAFT_SPORT_THEMES.map(s => [s]))('redraft identity — %s', sport => {
  it('ships both art files it references, and they differ by mode', () => {
    const dark = artUrl(sportBlock(sport, false))
    const light = artUrl(sportBlock(sport, true))
    expect(dark).toBe(`/artwork/redraft/${sport}/background-dark.svg`)
    expect(light).toBe(`/artwork/redraft/${sport}/background-light.svg`)
    expect(existsSync(join(process.cwd(), 'public', dark))).toBe(true)
    expect(existsSync(join(process.cwd(), 'public', light))).toBe(true)
    expect(read(join('public', dark))).not.toBe(read(join('public', light)))
  })

  it.each(MODES.map(m => [m.name, m]))('%s: accent text clears 4.5:1 on every card ground and the page ground', (_n, mode) => {
    const { rd, cards, page } = measure(sport, mode as Mode)
    const w = worst(hex(rd['--rd-accent-text']), [...cards, ...page])
    expect(w.ratio, `${sport}/${(mode as Mode).name} accent on ${w.on}`).toBeGreaterThanOrEqual(MIN)
  })

  it.each(MODES.map(m => [m.name, m]))('%s: the art never takes body, secondary or faint text below 4.5:1', (_n, mode) => {
    const m = mode as Mode
    const { page } = measure(sport, m)
    for (const token of ['--text', '--text2', '--muted', '--faint']) {
      const w = worst(hex(m.core[token]), page)
      expect(w.ratio, `${sport}/${m.name} ${token} on ${w.on}`).toBeGreaterThanOrEqual(MIN)
    }
  })

  it.each(MODES.map(m => [m.name, m]))('%s: ink on a filled accent clears 4.5:1', (_n, mode) => {
    const { rd, accent } = measure(sport, mode as Mode)
    expect(contrast(hex(rd['--rd-accent-ink']), accent)).toBeGreaterThanOrEqual(MIN)
  })
})
