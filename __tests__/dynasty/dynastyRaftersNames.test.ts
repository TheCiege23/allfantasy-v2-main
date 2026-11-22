/**
 * Champion names on the dynasty Home rafters (2026-11-06). Each pennant is 58x86px (52x78 on a phone) and the name
 * was one nowrap line capped at 50px, so "Gridiron Ghosts" read "Gridiro…" and "Bench Mob" "Bench …" at every size.
 * Widening is not available: five pennants already fill the phone row (292 of ~296px). The name now takes two lines,
 * clamped, and still ends above the pennant's V-notch — measured in /e2e/dynasty-core/home: 8px clear at 390, 15px
 * at 1440, and no name clipped.
 *
 * Checked here from the stylesheet: the name may wrap, is clamped to two lines, and two lines fit above the notch
 * (the clip-path's centre point) at both pennant sizes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'components/core-app/af-league-home-dynasty.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Declarations of a selector, top level or inside the phone block (`phone: true`), later wins. */
function decls(selector: string, phone = false): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const out: Record<string, string> = {}
  const add = (body: string) => {
    for (const d of body.split(';')) {
      const at = d.indexOf(':')
      if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim()
    }
  }
  const media = CSS.search(/@media\s*\(max-width:\s*\d+px\)\s*\{/)
  const top = media < 0 ? CSS : CSS.slice(0, media)
  for (const m of top.matchAll(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, 'g'))) add(m[1]!)
  if (phone && media >= 0) for (const m of CSS.slice(media).matchAll(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, 'g'))) add(m[1]!)
  return out
}
const px = (v: string | undefined) => Number.parseFloat(v ?? 'NaN')

describe('rafters pennant names', () => {
  const name = decls('.af-lh-dy-pennant-name')

  it('may wrap, clamped to two lines', () => {
    expect(name['white-space'], 'a nowrap name truncates "Gridiron Ghosts" to "Gridiro…"').not.toBe('nowrap')
    expect(name['-webkit-line-clamp'] ?? name['line-clamp']).toBe('2')
  })

  it.each([false, true])('two lines end above the V-notch (phone=%s)', (phone) => {
    const pennant = decls('.af-lh-dy-pennant', phone)
    const year = decls('.af-lh-dy-pennant-year')
    const notch = Number(pennant['clip-path']?.match(/50%\s+([\d.]+)%/)?.[1] ?? NaN) / 100
    expect(Number.isFinite(notch), 'no V-notch in the clip-path').toBe(true)
    const yearLine = px(year['font-size']) * (Number(year['line-height']) || 1)
    const nameLines = 2 * px(name['font-size']) * Number(name['line-height'])
    const textBottom = px(pennant['padding-top']) + yearLine + px(pennant.gap) + nameLines
    expect(textBottom).toBeLessThanOrEqual(px(pennant.height) * notch)
  })
})
