/**
 * Tribe buff SVG — TypeScript port of `buff(primary, secondary, uid)` from the late-season
 * handoff (tools/gen_late.py). Every gradient/clip id is prefixed with `uid` so several buffs
 * can sit inline on one page. Output is byte-identical to the Python generator for the same
 * inputs (see __tests__/survivor-buff-svg.test.ts).
 */

const INK = '#1a0f06'
const HEX = /^#[0-9a-fA-F]{6}$/
const UID = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/

/** Gold merge buff colours (gen_late.py BUFFS['merge']). */
export const MERGE_BUFF_COLORS = { primary: '#d9b45a', secondary: '#1b2a4a' } as const

/** Lighten (f > 0) or darken (f < 0) a #rrggbb colour exactly as gen_late.py `shade` does. */
export function shadeHex(hex: string, f: number): string {
  const h = hex.replace(/^#/, '')
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  if (f < 0) [r, g, b] = [r, g, b].map((c) => Math.trunc(c * (1 + f)))
  else [r, g, b] = [r, g, b].map((c) => Math.trunc(c + (255 - c) * f))
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}

/** Inputs are interpolated into markup, so only plain #rrggbb colours and safe ids are accepted. */
export function safeBuffColor(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback
}

export function buffSvg(primary: string, secondary: string, uid: string): string {
  const p = safeBuffColor(primary, MERGE_BUFF_COLORS.primary)
  const s = safeBuffColor(secondary, MERGE_BUFF_COLORS.secondary)
  if (!UID.test(uid)) throw new Error('buffSvg: uid must be a short alphanumeric id')
  const pd = shadeHex(p, -0.45)
  const pl = shadeHex(p, 0.25)
  const sd = shadeHex(s, -0.3)
  const zig = Array.from({ length: 21 }, (_, k) => k + 1).map((i) => `L${20 + i * 10},${98 + (i % 2 ? 6 : -6)}`).join(' ')
  const dia = Array.from({ length: 7 }, (_, i) => `<path d="M${34 + i * 26},112 l7,-8 l7,8 l-7,8 Z" fill="${s}" stroke="${pd}" stroke-width="1.2"/>`).join('')
  const dots = Array.from({ length: 7 }, (_, i) => `<circle cx="${40 + i * 26}" cy="88" r="2.4" fill="${s}"/><circle cx="${40 + i * 26}" cy="134" r="2.4" fill="${s}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 200" width="260" height="200" role="img" aria-label="Tribe buff">
<defs>
<linearGradient id="${uid}-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pl}"/><stop offset=".45" stop-color="${p}"/><stop offset="1" stop-color="${pd}"/></linearGradient>
<linearGradient id="${uid}-sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".18" stop-color="#000" stop-opacity="0"/><stop offset=".82" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
<clipPath id="${uid}-k"><path d="M20,78 C80,66 180,66 240,78 L240,146 C180,134 80,134 20,146 Z"/></clipPath>
</defs>
<ellipse cx="130" cy="186" rx="96" ry="8" fill="#000" opacity=".35"/>
<path d="M196,124 C214,150 222,168 236,182 L214,186 C206,168 196,150 186,132 Z" fill="${pd}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M200,126 C222,146 238,158 254,166 L240,182 C226,170 210,154 192,136 Z" fill="url(#${uid}-c)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M246,168 l-6,10 M238,162 l-8,10" stroke="${s}" stroke-width="2"/>
<g clip-path="url(#${uid}-k)">
  <rect x="0" y="60" width="260" height="100" fill="url(#${uid}-c)"/>
  <path d="M20,98 ${zig}" fill="none" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  ${dia}${dots}
  <path d="M20,124 C80,114 180,114 240,124" stroke="${sd}" stroke-width="1.5" fill="none" opacity=".7"/>
  <path d="M30,84 C70,74 120,72 150,74" stroke="#fff" stroke-width="5" fill="none" opacity=".25" stroke-linecap="round"/>
  <rect x="0" y="60" width="260" height="100" fill="url(#${uid}-sh)"/>
  <path d="M70,70 C74,100 72,120 66,140 M130,68 C134,100 132,120 128,134 M190,70 C194,100 190,120 186,140" stroke="#000" stroke-width="2" opacity=".14" fill="none"/>
</g>
<path d="M20,78 C80,66 180,66 240,78 L240,146 C180,134 80,134 20,146 Z" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
<path d="M176,98 C188,88 206,88 212,104 C218,120 204,134 188,130 C176,126 170,110 176,98 Z" fill="url(#${uid}-c)" stroke="${INK}" stroke-width="3.5"/>
<path d="M184,104 C192,98 202,100 204,110" stroke="${s}" stroke-width="2.5" fill="none"/>
</svg>`
}

/** Secondary colour for a tribe: from the catalogue entry with the same name, else a light neutral. */
export function buffColorsForTribe(
  tribe: { name?: string | null; colorHex?: string | null },
  catalog: ReadonlyArray<{ name: string; primary: string; secondary: string }>,
): { primary: string; secondary: string } {
  const match = catalog.find((entry) => entry.name.toLowerCase() === (tribe.name ?? '').trim().toLowerCase())
  const primary = safeBuffColor(tribe.colorHex, match?.primary ?? '#8a6420')
  return { primary, secondary: safeBuffColor(match?.secondary, '#f2c94c') }
}
