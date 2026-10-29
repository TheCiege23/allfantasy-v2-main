/**
 * Server-side tribe emblem composer — a byte-faithful TypeScript port of the handoff's
 * `tools/compose.py` (design-refs/native-league-handoff/tribes/). Output for catalogue
 * tribes matches the pre-built crests/marks exactly (see __tests__/survivor-tribe-emblems.test.ts),
 * which is why numbers are formatted the way Python prints them (`52.0`, half-even rounding).
 *
 * Inputs are untrusted at the route boundary: the tribe id must be a catalogue id, colours must be
 * `#rrggbb`, and the display name only ever reaches the SVG as outlined glyph paths plus an escaped
 * `<title>`, so no user text is ever emitted as markup.
 */
import 'server-only'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import opentype, { type Font, type GlyphPoint } from 'opentype.js'
import catalog from './tribeCatalog.json'

export type TribeFrame = 'shield' | 'roundel' | 'hex' | 'pennant'
export type TribeKit = 'football' | 'basketball' | 'baseball' | 'hockey' | 'soccer'
export type TribeSport = 'nfl' | 'ncaaf' | 'nba' | 'ncaab' | 'mlb' | 'nhl' | 'soccer'
export type TribeCatalogEntry = { id: string; name: string; mascot: string; primary: string; secondary: string; frame: string }
export type TribeColors = { primary?: string | null; secondary?: string | null }

export const TRIBE_KITS: readonly TribeKit[] = ['football', 'basketball', 'baseball', 'hockey', 'soccer']
export const TRIBE_SPORT_KIT: Record<TribeSport, TribeKit> = {
  nfl: 'football', ncaaf: 'football', nba: 'basketball', ncaab: 'basketball', mlb: 'baseball', nhl: 'hockey', soccer: 'soccer',
}
const COLLEGE = new Set<TribeSport>(['ncaaf', 'ncaab'])
const INK = '#0b0d14'
const HEX_RE = /^#[0-9a-f]{6}$/
export const TRIBE_NAME_MAX = 32

/** `#rrggbb` (case-insensitive, optional leading #) → lowercase `#rrggbb`, else null. */
export function normalizeTribeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = (value.startsWith('#') ? value : `#${value}`).toLowerCase()
  return HEX_RE.test(v) ? v : null
}

/** Display names: printable characters only, collapsed whitespace, bounded length. */
export function sanitizeTribeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return Array.from(cleaned).slice(0, TRIBE_NAME_MAX).join('')
}

export function findTribeCatalogEntry(id: unknown): TribeCatalogEntry | null {
  if (typeof id !== 'string') return null
  return (catalog as TribeCatalogEntry[]).find(t => t.id === id) ?? null
}

// ---------- Python number formatting ----------
/** Python `repr(float)`. */
export function pyFloat(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e16) return (v < 0 || Object.is(v, -0) ? '-' : '') + Math.abs(v).toFixed(1)
  const a = Math.abs(v)
  if (a !== 0 && a < 1e-4) {
    const [m, e] = v.toExponential().split('e')
    const exp = Number(e)
    return `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`
  }
  return String(v)
}

/** Python `format(v, '.Nf')` — exact-value rounding with ties to even (JS toFixed ties away). */
export function pyFixed(v: number, digits: number): string {
  const scale = 10 ** digits
  const s = v * 2 * scale
  if (Number.isInteger(s) && Math.abs(s) % 2 === 1 && s % 5 ** digits === 0 && s / (2 * scale) === v) {
    const lo = (Math.abs(s) - 1) / 2
    const n = lo % 2 === 0 ? lo : lo + 1
    const str = (n / scale).toFixed(digits)
    return v < 0 ? `-${str}` : str
  }
  const out = v.toFixed(digits)
  return out
}

/** Python `round(x)` to int: ties to even. */
function pyRound(x: number): number {
  const f = Math.floor(x)
  const diff = x - f
  if (diff > 0.5) return f + 1
  if (diff < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

/** Python float `%`: result takes the divisor's sign. */
function pyMod(x: number, y: number): number {
  let m = x % y
  if (m !== 0) { if ((y < 0) !== (m < 0)) m += y } else m = y < 0 ? -0 : 0
  return m
}

// ---------- colour helpers (colorsys) ----------
const ONE_THIRD = 1.0 / 3.0
const ONE_SIXTH = 1.0 / 6.0
const TWO_THIRD = 2.0 / 3.0

function hx(c: string): [number, number, number] {
  const h = c.replace(/^#/, '')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}
function tohex(t: [number, number, number]): string {
  return '#' + t.map(v => Math.max(0, Math.min(255, pyRound(v * 255))).toString(16).padStart(2, '0')).join('')
}
function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b)
  const minc = Math.min(r, g, b)
  const sumc = maxc + minc
  const rangec = maxc - minc
  const l = sumc / 2.0
  if (minc === maxc) return [0.0, l, 0.0]
  const s = l <= 0.5 ? rangec / sumc : rangec / (2.0 - maxc - minc)
  const rc = (maxc - r) / rangec
  const gc = (maxc - g) / rangec
  const bc = (maxc - b) / rangec
  let h: number
  if (r === maxc) h = bc - gc
  else if (g === maxc) h = 2.0 + rc - bc
  else h = 4.0 + gc - rc
  h = pyMod(h / 6.0, 1.0)
  return [h, l, s]
}
function hueV(m1: number, m2: number, hue: number): number {
  hue = pyMod(hue, 1.0)
  if (hue < ONE_SIXTH) return m1 + (m2 - m1) * hue * 6.0
  if (hue < 0.5) return m2
  if (hue < TWO_THIRD) return m1 + (m2 - m1) * (TWO_THIRD - hue) * 6.0
  return m1
}
function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0.0) return [l, l, l]
  const m2 = l <= 0.5 ? l * (1.0 + s) : l + s - l * s
  const m1 = 2.0 * l - m2
  return [hueV(m1, m2, h + ONE_THIRD), hueV(m1, m2, h), hueV(m1, m2, h - ONE_THIRD)]
}
function shade(c: string, l = 0.0, s = 0.0): string {
  const [h, li, sa] = rgbToHls(...hx(c))
  return tohex(hlsToRgb(h, Math.max(0, Math.min(1, li + l)), Math.max(0, Math.min(1, sa + s))))
}

export type TribePalette = Record<string, string>

/** Port of `palette()` — the derived shades every layer resolves its colour classes against. */
export function tribePalette(primary: string, secondary: string): TribePalette {
  const p = primary
  const s = secondary
  const P: TribePalette = {
    p, pd: shade(p, -0.16), pl: shade(p, 0.14),
    s, sd: shade(s, -0.16), sl: shade(s, 0.14),
    l: '#f3ecdc', ld: '#cdbf9f',
    k: INK, e: '#ffd84a', r: '#d23a3a', rd: '#4a1620',
    br: '#8a4a22', brd: '#5e2f14', or: '#e2742b', ord: '#b5541a',
    mt: '#c3cad6', mtd: '#7d8699', wd: '#dcb27a', wdd: '#a87c48',
  }
  const base = rgbToHls(...hx(p))[1] > 0.3 ? p : s
  P.field = shade(base, -0.40, -0.15)
  P.field2 = shade(base, -0.35, -0.15)
  return P
}

// ---------- text to path (fontTools SVGPathPen semantics) ----------
const FONT_FILE = path.join(process.cwd(), 'node_modules', '@fontsource', 'archivo', 'files', 'archivo-latin-800-normal.woff')
let fontCache: Font | null = null
function loadFont(): Font {
  if (!fontCache) {
    const buf = readFileSync(FONT_FILE)
    fontCache = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  }
  return fontCache
}

type Pt = [number, number]
class SvgPathPen {
  private cmds: string[] = []
  private last: string | null = null
  private lastX: number | null = null
  private lastY: number | null = null
  private pt(p: Pt) { return `${pyFloat(p[0])} ${pyFloat(p[1])}` }
  moveTo(p: Pt) {
    if (this.last === 'M') this.cmds.pop()
    this.cmds.push(`M${this.pt(p)}`)
    this.last = 'M'
    ;[this.lastX, this.lastY] = p
  }
  lineTo(p: Pt) {
    const [x, y] = p
    if (x === this.lastX && y === this.lastY) return
    let cmd: string | null
    let pts: string
    if (x === this.lastX) { cmd = 'V'; pts = pyFloat(y) }
    else if (y === this.lastY) { cmd = 'H'; pts = pyFloat(x) }
    else if (this.last === 'M') { cmd = null; pts = ' ' + this.pt(p) }
    else { cmd = 'L'; pts = this.pt(p) }
    let t = ''
    if (cmd) { t += cmd; this.last = cmd }
    this.cmds.push(t + pts)
    ;[this.lastX, this.lastY] = p
  }
  qCurveToOne(p1: Pt, p2: Pt) {
    this.cmds.push(`Q${this.pt(p1)} ${this.pt(p2)}`)
    this.last = 'Q'
    ;[this.lastX, this.lastY] = p2
  }
  /** BasePen.qCurveTo: implied on-curve midpoints between consecutive off-curve points. */
  qCurveTo(points: (Pt | null)[]) {
    let pts = points
    if (pts[pts.length - 1] === null) {
      // Contour with no on-curve points: start at the implied point between last and first.
      const offs = pts.slice(0, -1) as Pt[]
      const a = offs[offs.length - 1]
      const b = offs[0]
      const implied: Pt = [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])]
      this.moveTo(implied)
      pts = [...offs, implied]
    }
    const p = pts as Pt[]
    const n = p.length - 1
    if (n === 0) { this.lineTo(p[0]); return }
    for (let i = 0; i < n - 1; i++) {
      const [x, y] = p[i]
      const [nx, ny] = p[i + 1]
      this.qCurveToOne(p[i], [0.5 * (x + nx), 0.5 * (y + ny)])
    }
    this.qCurveToOne(p[n - 1], p[n])
  }
  closePath() {
    this.cmds.push('Z')
    this.last = 'Z'
    this.lastX = this.lastY = null
  }
  get commands() { return this.cmds.join('') }
}

/** fontTools glyf `Glyph.draw` through a TransformPen(sc, 0, 0, -sc, dx, 0). */
function drawGlyph(points: GlyphPoint[], pen: SvgPathPen, sc: number, dx: number, offset: number) {
  const tf = (q: GlyphPoint): Pt => {
    const x = q.x + offset
    return [sc * x + 0 * q.y + dx, 0 * x + -sc * q.y + 0]
  }
  let start = 0
  for (let i = 0; i < points.length; i++) {
    if (!points[i].lastPointOfContour) continue
    let contour = points.slice(start, i + 1)
    start = i + 1
    if (!contour.some(q => q.onCurve)) {
      pen.qCurveTo([...contour.map(tf), null])
      pen.closePath()
      continue
    }
    const firstOn = contour.findIndex(q => q.onCurve) + 1
    contour = [...contour.slice(firstOn), ...contour.slice(0, firstOn)]
    pen.moveTo(tf(contour[contour.length - 1]))
    while (contour.length) {
      const nextOn = contour.findIndex(q => q.onCurve) + 1
      if (nextOn === 1) {
        if (contour.length > 1) pen.lineTo(tf(contour[0]))
      } else {
        pen.qCurveTo(contour.slice(0, nextOn).map(tf))
      }
      contour = contour.slice(nextOn)
    }
    pen.closePath()
  }
}

/** Port of `text_path()`: outline `txt` centred on `cx`, auto-shrinking to `maxW`. */
export function tribeTextPath(txt: string, cx: number, baseline: number, size: number, maxW: number, tracking = 0.04): { svg: string; size: number } {
  const font = loadFont()
  const upm = font.unitsPerEm
  const build = (sz: number): [string[], number] => {
    const sc = sz / upm
    let x = 0
    const parts: string[] = []
    for (const ch of Array.from(txt)) {
      const gi = font.charToGlyphIndex(ch)
      if (!gi) continue
      const glyph = font.glyphs.get(gi)
      void glyph.path // opentype.js resolves composite glyph points lazily
      const pen = new SvgPathPen()
      const offset = glyph.leftSideBearing != null && glyph.xMin != null ? glyph.leftSideBearing - glyph.xMin : 0
      drawGlyph(glyph.points ?? [], pen, sc, x, offset)
      parts.push(pen.commands)
      x += glyph.advanceWidth * sc + tracking * sz
    }
    return [parts, x - tracking * sz]
  }
  let [parts, w] = build(size)
  if (w > maxW) {
    size = size * maxW / w
    ;[parts, w] = build(size)
  }
  return { svg: `<path transform="translate(${pyFixed(cx - w / 2, 2)},${pyFixed(baseline, 2)})" d="${parts.join(' ')}"/>`, size }
}

// ---------- frames (viewBox 0 0 300 330) ----------
const FRAMES: Record<TribeFrame, string> = {
  shield: 'M40,36 H260 V150 C260,232 200,282 150,308 C100,282 40,232 40,150 Z',
  roundel: 'M150,38 A124,124 0 1 1 149.9,38 Z',
  hex: 'M150,32 L264,98 L264,228 L150,294 L36,228 L36,98 Z',
  pennant: 'M40,30 L112,30 L150,52 L188,30 L260,30 V160 C260,236 204,284 150,308 C96,284 40,236 40,160 Z',
}
const CENTER: Record<TribeFrame, [number, number]> = { shield: [150, 165], roundel: [150, 162], hex: [150, 163], pennant: [150, 168] }

function scaled(d: string, f: number, c: [number, number]): string {
  const [cx, cy] = c
  if (d.includes('A')) {
    const r = 124 * f
    const top = cy - r
    return `M${cx},${pyFixed(top, 1)} A${pyFixed(r, 1)},${pyFixed(r, 1)} 0 1 1 ${pyFloat(cx - 0.1)},${pyFixed(top, 1)} Z`
  }
  let d2 = d.replace(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g, (_m, a: string, b: string) => {
    const x = parseFloat(a)
    const y = parseFloat(b)
    return `${pyFixed(cx + (x - cx) * f, 1)},${pyFixed(cy + (y - cy) * f, 1)}`
  })
  d2 = d2.replace(/A(\d+),(\d+)/g, (_m, a: string, b: string) => `A${pyFixed(parseFloat(a) * f, 1)},${pyFixed(parseFloat(b) * f, 1)}`)
  return d2
}

// ---------- sport ornaments (behind frame) ----------
function football(cx: number, cy: number, rot: number, P: TribePalette, L = 80, H = 44): string {
  const F = pyFloat
  return `<g transform="translate(${cx},${cy}) rotate(${rot})">
<path d="M${F(-L / 2)},0 C${F(-L / 4)},${F(-H / 1.6)} ${F(L / 4)},${F(-H / 1.6)} ${F(L / 2)},0 C${F(L / 4)},${F(H / 1.6)} ${F(-L / 4)},${F(H / 1.6)} ${F(-L / 2)},0 Z" fill="${P.br}" stroke="${INK}" stroke-width="5"/>
<path d="M${F(-L / 2 + 10)},-4 C${F(-L / 4)},${F(-H / 2.3)} ${F(L / 4)},${F(-H / 2.3)} ${F(L / 2 - 10)},-4" fill="none" stroke="${P.brd}" stroke-width="3" opacity=".7"/>
<path d="M${F(-L * 0.36)},${F(-H * 0.18)} C${F(-L * 0.3)},${F(-H * 0.05)} ${F(-L * 0.3)},${F(H * 0.05)} ${F(-L * 0.36)},${F(H * 0.18)} M${F(L * 0.36)},${F(-H * 0.18)} C${F(L * 0.3)},${F(-H * 0.05)} ${F(L * 0.3)},${F(H * 0.05)} ${F(L * 0.36)},${F(H * 0.18)}" fill="none" stroke="${P.l}" stroke-width="3.5"/>
<path d="M${F(-L * 0.18)},-2 H${F(L * 0.18)}" stroke="${P.l}" stroke-width="4" stroke-linecap="round"/>
${[-12, -4, 4, 12].map(x => `<path d="M${x},-8 V4" stroke="${P.l}" stroke-width="3.5" stroke-linecap="round"/>`).join('')}
</g>`
}

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5
    const rr = i % 2 === 0 ? r : r * 0.45
    pts.push(`${pyFixed(cx + rr * Math.cos(a), 1)},${pyFixed(cy + rr * Math.sin(a), 1)}`)
  }
  return `<polygon points="${pts.join(' ')}"/>`
}

function ornament(kit: TribeKit, P: TribePalette): string {
  if (kit === 'football') return football(40, 70, -40, P, 104, 56) + football(260, 70, 40, P, 104, 56)
  if (kit === 'basketball') {
    return `<g transform="translate(150,40)"><circle r="52" fill="${P.or}" stroke="${INK}" stroke-width="6"/>
<path d="M-58,0 H58 M0,-58 V58 M-41,-41 C-14,-18 -14,18 -41,41 M41,-41 C14,-18 14,18 41,41" fill="none" stroke="${INK}" stroke-width="4"/>
<path d="M-40,-30 A50,50 0 0 1 -6,-50" fill="none" stroke="#f6a76a" stroke-width="5" stroke-linecap="round" opacity=".8"/></g>`
  }
  if (kit === 'baseball') {
    const bat = (r: number) => `<g transform="translate(150,170) rotate(${r})"><path d="M-6,150 L-7,30 C-9,-20 -16,-80 -14,-150 C-13,-162 13,-162 14,-150 C16,-80 9,-20 7,30 L6,150 Z" fill="${P.wd}" stroke="${INK}" stroke-width="5"/>
<path d="M-11,150 H11 V160 H-11 Z" fill="${P.wdd}" stroke="${INK}" stroke-width="4"/><path d="M-6,105 H6 M-6,115 H6 M-6,125 H6" stroke="${INK}" stroke-width="2.5"/>
<path d="M-6,-140 C-7,-100 -4,-60 -3,-20" stroke="#f4dcae" stroke-width="3" fill="none" stroke-linecap="round"/></g>`
    const ball = `<g transform="translate(150,26)"><circle r="24" fill="${P.l}" stroke="${INK}" stroke-width="5"/>
<path d="M-15,-20 C-6,-8 -6,8 -15,20 M15,-20 C6,-8 6,8 15,20" fill="none" stroke="${P.r}" stroke-width="3" stroke-dasharray="4 3"/></g>`
    return bat(-40) + bat(40) + ball
  }
  if (kit === 'hockey') {
    const stick = (r: number, flip: number) => `<g transform="translate(150,150) rotate(${r}) scale(${flip},1)"><path d="M-6,-215 L6,-215 L6,110 C6,128 18,136 46,136 L50,152 C14,154 -6,146 -6,120 Z" fill="${P.wd}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M-6,-215 H6 V-175 H-6 Z" fill="${INK}"/><path d="M-7,-221 H7 V-213 H-7 Z" fill="${INK}"/><path d="M8,128 C20,138 34,140 48,141" stroke="${P.l}" stroke-width="5" fill="none"/></g>`
    const puck = `<g transform="translate(150,20)"><ellipse cx="0" cy="6" rx="30" ry="11" fill="${INK}"/><ellipse rx="30" ry="11" fill="#22252e" stroke="${INK}" stroke-width="4"/><ellipse rx="25" ry="7" fill="none" stroke="${P.mtd}" stroke-width="2"/></g>`
    return stick(-38, 1) + stick(38, -1) + puck
  }
  const pent = (x: number, y: number, r: number, s: number) => `<polygon transform="translate(${x},${y}) rotate(${r}) scale(${s})" points="0,-10 9.5,-3.1 5.9,8.1 -5.9,8.1 -9.5,-3.1" fill="${INK}"/>`
  return `<g transform="translate(150,40)"><circle r="50" fill="${P.l}" stroke="${INK}" stroke-width="6"/>
${pent(0, 0, 0, 1.6)}${pent(0, -44, 180, 1.1)}${pent(42, -14, 180, 1.1)}${pent(26, 36, 180, 1.1)}${pent(-26, 36, 180, 1.1)}${pent(-42, -14, 180, 1.1)}
<path d="M0,-16 L0,-33 M15,-5 L32,-10 M9,13 L20,27 M-9,13 L-20,27 M-15,-5 L-32,-10" stroke="${INK}" stroke-width="3"/></g>
<g fill="${P.s}" stroke="${INK}" stroke-width="3">${star(30, 30, 14)}${star(270, 30, 14)}</g>`
}

// ---------- mascot loading ----------
export const TRIBE_MASCOT_DIR = path.join(process.cwd(), 'lib', 'survivor', 'tribe-art', 'mascots')
const mascotCache = new Map<string, Record<string, string>>()

/** Parse `<g id="X">…</g><!-- /X -->` layers. `id` must already be a catalogue id. */
export function parseMascotLayers(src: string): Record<string, string> {
  const layers: Record<string, string> = {}
  const re = /<g\s+id="([a-z-]+)"[^>]*>([\s\S]*?)<\/g>\s*<!--\s*\/\1\s*-->/g
  for (const m of src.matchAll(re)) layers[m[1]] = m[2]
  return layers
}

function loadMascot(id: string): Record<string, string> {
  if (!findTribeCatalogEntry(id)) throw new Error('unknown tribe')
  let layers = mascotCache.get(id)
  if (!layers) {
    layers = parseMascotLayers(readFileSync(path.join(TRIBE_MASCOT_DIR, `${id}.svg`), 'utf8'))
    mascotCache.set(id, layers)
  }
  return layers
}

function resolveClasses(svg: string, P: TribePalette): string {
  const pick = (cls: string) => {
    if (!(cls in P)) throw new Error(`unknown colour class ${cls}`)
    return P[cls]
  }
  return svg
    .replace(/stroke-class="([a-z]+)"/g, (_m, c: string) => `stroke="${pick(c)}"`)
    .replace(/(?<![-\w])class="([a-z]+)"/g, (_m, c: string) => `fill="${pick(c)}"`)
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function resolveColors(tribe: TribeCatalogEntry, colors?: TribeColors): { primary: string; secondary: string } {
  return {
    primary: normalizeTribeHex(colors?.primary) ?? tribe.primary,
    secondary: normalizeTribeHex(colors?.secondary) ?? tribe.secondary,
  }
}

function mascotMarkup(tribe: TribeCatalogEntry, kit: TribeKit, P: TribePalette): string {
  const L = loadMascot(tribe.id)
  return resolveClasses((L[`back-${kit}`] ?? '') + L.body + (L[`front-${kit}`] ?? ''), P)
}

export type BuildTribeCrestInput = { tribe: TribeCatalogEntry; sport: TribeSport; colors?: TribeColors; name?: string | null }

/** Port of `crest()`. `name` overrides the banner/title (a renamed tribe); defaults to the catalogue name. */
export function buildTribeCrest({ tribe, sport, colors, name }: BuildTribeCrestInput): string {
  const kit = TRIBE_SPORT_KIT[sport]
  if (!kit) throw new Error('unknown sport')
  const { primary, secondary } = resolveColors(tribe, colors)
  const P = tribePalette(primary, secondary)
  const uid = `${tribe.id}-${sport}`
  const fr = (tribe.frame in FRAMES ? tribe.frame : 'shield') as TribeFrame
  const d = FRAMES[fr]
  const c = CENTER[fr]
  const mascot = mascotMarkup(tribe, kit, P)
  const displayName = sanitizeTribeName(name) ?? tribe.name
  const banner = tribeTextPath(displayName.toUpperCase(), 150, 283, 30, 168).svg
  const inner = scaled(d, 0.88, c)
  const inner2 = scaled(d, 0.82, c)
  const college = COLLEGE.has(sport)
  let stripes = ''
  for (let x = 0; x < 700; x += 26) stripes += `<path d="M${x},0 L${x - 330},330" stroke="${P.field2}" stroke-width="9"/>`
  const bannerFill = P.s
  const bannerInk = hx(P.s).reduce((a, b) => a + b, 0) > 1.6 ? INK : P.l
  const tail = (sx: number) => `<path transform="translate(150,0) scale(${sx},1) translate(-150,0)" d="M58,262 L14,268 L30,284 L12,300 L66,296 Z" fill="${P.sd}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
<path transform="translate(150,0) scale(${sx},1) translate(-150,0)" d="M58,262 L66,296 L76,288 Z" fill="${INK}" opacity=".55"/>`
  const varsity = college
    ? `<path d="M48,260 Q150,250 252,260" fill="none" stroke="${P.p}" stroke-width="3"/><path d="M48,299 Q150,289 252,299" fill="none" stroke="${P.p}" stroke-width="3"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -26 300 356" width="300" height="356">
<title>${escapeXml(displayName)} — ${escapeXml(tribe.mascot)} (${sport.toUpperCase()})</title>
<defs><clipPath id="c-${uid}"><path d="${inner}"/></clipPath>
<radialGradient id="v-${uid}" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="${P.pl}" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient></defs>
<g>${ornament(kit, P)}</g>
<path d="${d}" fill="${P.s}" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="${P.sl}" stroke-width="2" opacity=".6"/>
<path d="${inner}" fill="${P.field}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
<g clip-path="url(#c-${uid})">${stripes}<rect y="-26" width="300" height="356" fill="url(#v-${uid})"/></g>
<path d="${inner2}" fill="none" stroke="${P.p}" stroke-width="2.5" opacity=".55" stroke-dasharray="${college ? '7 5' : 'none'}"/>
<g transform="translate(${c[0] - 104},${c[1] - 122}) scale(${pyFixed(208 / 240, 4)})">${mascot}</g>
${tail(1)}${tail(-1)}
<path d="M44,256 Q150,244 256,256 L256,300 Q150,288 44,300 Z" fill="${bannerFill}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M50,262 Q150,251 250,262" fill="none" stroke="#fff" stroke-width="2" opacity=".35"/>
${varsity}
<g fill="${bannerInk}">${banner}</g>
</svg>`
}

export type BuildTribeMarkInput = { tribe: TribeCatalogEntry; kit: TribeKit; colors?: TribeColors; name?: string | null }

/** Port of `mark()`: circular avatar (mascot + kit on field, no banner). */
export function buildTribeMark({ tribe, kit, colors, name }: BuildTribeMarkInput): string {
  if (!TRIBE_KITS.includes(kit)) throw new Error('unknown kit')
  const { primary, secondary } = resolveColors(tribe, colors)
  const P = tribePalette(primary, secondary)
  const uid = `${tribe.id}-m-${kit}`
  const mascot = mascotMarkup(tribe, kit, P)
  const displayName = sanitizeTribeName(name) ?? tribe.name
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
<title>${escapeXml(displayName)} mark</title>
<defs><clipPath id="c-${uid}"><circle cx="120" cy="120" r="108"/></clipPath></defs>
<circle cx="120" cy="120" r="114" fill="${P.s}" stroke="${INK}" stroke-width="8"/>
<circle cx="120" cy="120" r="102" fill="${P.field}" stroke="${INK}" stroke-width="4"/>
<g clip-path="url(#c-${uid})"><g transform="translate(14,10) scale(.88)">${mascot}</g></g>
</svg>`
}
