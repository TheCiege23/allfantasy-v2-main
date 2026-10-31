/**
 * Redraft League chat (batch A4): WCAG contrast of everything components/chat/redraft-chat.css draws,
 * measured from the SHIPPED files — the conversation's palette in components/core-app/af-comms.css
 * (`.af-cm`, `html[data-mode='light'] .af-cm`), /core's palette in components/core-app/af-core.css
 * (the panel and the pinned score sit outside `.af-cm`), the sport tokens in
 * components/league/native/redraft-identity.css, and the art under public/artwork/redraft/.
 * Plus the stylesheet's own rules: 11px type floor, no hex, and the art really is the conversation's
 * ground (a contrast test of art nobody draws would pass forever).
 *
 * The AF theme (`data-mode=legacy`) uses the dark palette on both sides (`.af-cm` has no AF block;
 * redraft-identity.css's bare sport block is the AF palette), so "dark" covers it.
 */
import { readFileSync } from 'node:fs'
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
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const over = (fg: RGB, a: number, bg: RGB): RGB => fg.map((c, i) => c * a + bg[i] * (1 - a)) as RGB
function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out[m[1]] = m[2].trim()
  return out
}
function block(css: string, re: RegExp, what: string): Record<string, string> {
  const m = css.match(re)
  if (!m) throw new Error(`${what} not found`)
  return tokens(m[1])
}

const COMMS = stripComments(read('components/core-app/af-comms.css'))
const CM_DARK = block(COMMS, /\n\.af-cm \{([^}]*--bg:[^}]*)\}/, '.af-cm palette')
const CM_LIGHT = { ...CM_DARK, ...block(COMMS, /html\[data-mode='light'\] \.af-cm \{([^}]*)\}/, 'light .af-cm palette') }
const CORE = stripComments(read('components/core-app/af-core.css'))
const CORE_DARK = block(CORE, /(?:^|\n)\.af-core \{([^}]*)\}/, '.af-core palette')
const CORE_LIGHT = { ...CORE_DARK, ...block(CORE, /html\[data-mode='light'\] \.af-core \{([^}]*)\}/, 'light .af-core palette') }
const RD = stripComments(read('components/league/native/redraft-identity.css'))
function sportBlock(sport: string, light: boolean): Record<string, string> {
  const prefix = light ? String.raw`html\[data-mode='light'\] ` : String.raw`(?:^|\n)`
  return block(RD, new RegExp(`${prefix}\\.af-core\\.nl-workspace\\[data-format=redraft\\]\\[data-sport=${sport}\\]\\{([^}]*)\\}`), `${sport} ${light ? 'light' : 'dark'} sport block`)
}
const CHAT_CSS_RAW = read('components/chat/redraft-chat.css')
const CHAT_CSS = stripComments(CHAT_CSS_RAW)
/** The score / recap card tint: `--rdc-tint: color-mix(in srgb, var(--rd-accent) N%, var(--surface))`. */
const TINT = (() => {
  const m = CHAT_CSS.match(/--rdc-tint:\s*color-mix\(in srgb,\s*var\(--rd-accent\)\s*([\d.]+)%,\s*var\(--surface\)\)/)
  if (!m) throw new Error('redraft-chat.css: --rdc-tint is not the color-mix this test models')
  return Number(m[1]) / 100
})()

function artInks(svg: string) {
  const strokes: Array<{ rgb: RGB; a: number }> = []
  const fills: Array<{ rgb: RGB; a: number }> = []
  for (const m of svg.matchAll(/stroke="(#[0-9a-fA-F]{3,6})"[^>]*?stroke-opacity="([\d.]+)"/g)) strokes.push({ rgb: hex(m[1]), a: Number(m[2]) })
  for (const m of svg.matchAll(/fill="(#[0-9a-fA-F]{3,6})"[^>]*?fill-opacity="([\d.]+)"/g)) fills.push({ rgb: hex(m[1]), a: Number(m[2]) })
  const painted = [...svg.matchAll(/(?:stroke|fill)="(#[0-9a-fA-F]{3,6})"/g)].length
  if (painted !== strokes.length + fills.length) throw new Error(`art has ${painted} inks, parsed ${strokes.length + fills.length}`)
  return { strokes, fills }
}

type Ground = [string, RGB]
function worst(fg: RGB, grounds: Ground[]): { ratio: number; on: string } {
  return grounds.map(([on, g]) => ({ ratio: contrast(fg, g), on })).sort((x, y) => x.ratio - y.ratio)[0]
}

const MODES = [
  { name: 'dark', cm: CM_DARK, core: CORE_DARK, light: false },
  { name: 'light', cm: CM_LIGHT, core: CORE_LIGHT, light: true },
] as const

function measure(sport: string, mode: (typeof MODES)[number]) {
  const rd = sportBlock(sport, mode.light)
  const soft = rgba(rd['--rd-accent-soft'])
  const accent = hex(rd['--rd-accent'])
  const bg = hex(mode.cm['--bg'])
  const surface = hex(mode.cm['--surface'])
  const art = rd['--rd-art'].match(/url\('([^']+)'\)/)![1]
  const { strokes, fills } = artInks(read(join('public', art)))
  const filled = fills.reduce((g, f) => over(f.rgb, f.a, g), bg)
  // The conversation ground: .af-cm's --bg under every art fill, then each stroke on top, one at a time.
  const convo: Ground[] = [['convo --bg', bg], ['convo --bg + fills', filled], ...strokes.map(({ rgb, a }, i): Ground => [`convo under stroke #${i}`, over(rgb, a, filled)])]
  // Cards: the event card and the framed bubble (--surface), the score / recap card's --rdc-tint.
  const cards: Ground[] = [['card --surface', surface], ['card --rdc-tint', over(accent, TINT, surface)]]
  // The pinned score lives in the panel, outside .af-cm: /core's --surface under the -soft tint.
  const coreSurface = hex(mode.core['--surface'])
  const pinned: Ground[] = [['pinned -soft over /core --surface', over(soft.rgb, soft.a, coreSurface)]]
  return { rd, convo, cards, pinned, strokes }
}

describe('redraft chat contrast — evaluator controls', () => {
  it('reproduces known ratios', () => {
    expect(contrast(hex('#000000'), hex('#ffffff'))).toBeCloseTo(21, 5)
    expect(contrast(hex('#777777'), hex('#ffffff'))).toBeCloseTo(4.48, 2)
  })
  it('read real palettes (a regex that matched nothing would measure undefined)', () => {
    for (const t of ['--bg', '--surface', '--text', '--text2', '--muted', '--faint']) {
      expect(CM_DARK[t], `.af-cm ${t}`).toMatch(/^#/)
      expect(CM_LIGHT[t], `light .af-cm ${t}`).toMatch(/^#/)
    }
    expect(CM_LIGHT['--bg']).not.toBe(CM_DARK['--bg'])
  })
  it('FAILS a known-bad ground: the art at 40% under light --muted', () => {
    const loud = over(hex('#136a3a'), 0.4, hex(CM_LIGHT['--bg']))
    expect(contrast(hex(CM_LIGHT['--muted']), loud)).toBeLessThan(MIN)
  })
  it('FAILS a known-bad tint: the 16% -soft that shipped first, under soccer --muted in dark', () => {
    expect(contrast(hex(CM_DARK['--muted']), over(hex('#b5e655'), 0.16, hex(CM_DARK['--surface'])))).toBeLessThan(MIN)
  })
  it('FAILS a known-bad pair: the dark NBA accent as text on the light card', () => {
    expect(contrast(hex('#ff9a3c'), hex(CM_LIGHT['--surface']))).toBeLessThan(MIN)
  })
  it('reads every art file it measures', () => {
    for (const sport of REDRAFT_SPORT_THEMES) for (const mode of MODES) expect(measure(sport, mode).strokes.length).toBeGreaterThan(0)
  })
})

describe.each(REDRAFT_SPORT_THEMES.map(s => [s]))('redraft chat contrast — %s', sport => {
  it.each(MODES.map(m => [m.name, m]))('%s: text on the conversation ground clears 4.5:1 with the art under it', (_n, mode) => {
    const m = mode as (typeof MODES)[number]
    const { convo } = measure(sport, m)
    for (const t of ['--text', '--text2', '--muted', '--faint']) {
      const w = worst(hex(m.cm[t]), convo)
      expect(w.ratio, `${sport}/${m.name} ${t} on ${w.on}`).toBeGreaterThanOrEqual(MIN)
    }
  })
  it.each(MODES.map(m => [m.name, m]))('%s: the event card label, body and time clear 4.5:1', (_n, mode) => {
    const m = mode as (typeof MODES)[number]
    const { rd, cards } = measure(sport, m)
    for (const [name, fg] of [['--rd-accent-text', rd['--rd-accent-text']], ['--text', m.cm['--text']], ['--text2', m.cm['--text2']], ['--muted', m.cm['--muted']]] as const) {
      const w = worst(hex(fg), cards)
      expect(w.ratio, `${sport}/${m.name} ${name} on ${w.on}`).toBeGreaterThanOrEqual(MIN)
    }
  })
  it.each(MODES.map(m => [m.name, m]))('%s: the pinned score clears 4.5:1', (_n, mode) => {
    const m = mode as (typeof MODES)[number]
    const { rd, pinned } = measure(sport, m)
    for (const [name, fg] of [['--rd-accent-text', rd['--rd-accent-text']], ['--text', m.core['--text']], ['--text2', m.core['--text2']], ['--muted', m.core['--muted']]] as const) {
      const w = worst(hex(fg), pinned)
      expect(w.ratio, `${sport}/${m.name} ${name} on ${w.on}`).toBeGreaterThanOrEqual(MIN)
    }
  })
  it.each(MODES.map(m => [m.name, m]))('%s: your bubble and the active channel (ink on the accent fill) clear 4.5:1', (_n, mode) => {
    const { rd } = measure(sport, mode as (typeof MODES)[number])
    expect(contrast(hex(rd['--rd-accent-ink']), hex(rd['--rd-accent']))).toBeGreaterThanOrEqual(MIN)
    // The bubble fill is --accent re-pointed at --rd-accent-text; the pair above holds only if they are one colour.
    expect(rd['--rd-accent-text']).toBe(rd['--rd-accent'])
  })
})

describe('redraft-chat.css — what the measurements above assume', () => {
  it('paints the sport art on the conversation ground over --bg', () => {
    const rule = CHAT_CSS.match(/\[data-testid=league-chat-conversation\]\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/background-color:\s*var\(--bg\)/)
    expect(rule).toMatch(/background-image:\s*var\(--rd-art\)/)
  })
  it('re-points the conversation accent at the sport (own bubbles = --accent / --accent-ink)', () => {
    const rule = CHAT_CSS.match(/\.rdc \.af-cm\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/--accent:\s*var\(--rd-accent-text\)/)
    expect(rule).toMatch(/--accent-ink:\s*var\(--rd-accent-ink\)/)
  })
  it('every rule is scoped under the redraft workspace AND the chat surface', () => {
    const selectors = [...CHAT_CSS.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(s => s && !s.startsWith('@'))
    expect(selectors.length).toBeGreaterThan(20)
    for (const sel of selectors) for (const part of sel.split(',')) {
      expect(part.trim(), part).toMatch(/^\.nl-workspace\[data-format=redraft\]\[data-sport\] \.rdc\b/)
    }
  })
  it('has no hex colours (tokens only)', () => {
    expect(CHAT_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
  it('keeps the 11px type floor', () => {
    const sizes = [...CHAT_CSS.matchAll(/font-size:\s*([\d.]+)px/g), ...CHAT_CSS.matchAll(/font:\s*\d+\s+([\d.]+)px/g)].map(m => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(5)
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(11)
  })
  it('has one top-level @media block, at the end, with nothing nested in it', () => {
    const at = [...CHAT_CSS.matchAll(/@media/g)]
    expect(at.length).toBe(1)
    const tail = CHAT_CSS.slice(at[0].index!)
    // Inside the block every rule closes before the next opens: depth never exceeds 2.
    let depth = 0
    let max = 0
    for (const ch of tail) {
      if (ch === '{') max = Math.max(max, ++depth)
      if (ch === '}') depth--
    }
    expect(depth).toBe(0)
    expect(max).toBe(2)
    expect(CHAT_CSS.slice(at[0].index!).trim().endsWith('}')).toBe(true)
  })
})

describe('redraft chat TSX — no new hex, no sub-11px type', () => {
  it.each(['components/chat/RedraftChatEventCard.tsx', 'lib/league-chat/redraftChatEvents.ts'])('%s', file => {
    const src = read(file)
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/)
    expect(src).not.toMatch(/text-\[(?:[0-9]|10)(?:\.\d+)?px\]/)
  })
})
