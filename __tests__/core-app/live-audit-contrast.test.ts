/**
 * Contrast findings from a live /core audit (2026-11-05, 390px, dark/light/AF):
 * - War Room (Scout) manager names inherited the global heading ink in AF mode: 1.09:1 on the AF card.
 * - Trades' 11px side labels and count labels used --faint: 3.8 (dark) and 4.0 (AF), under 4.5.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = (f: string) => readFileSync(join(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (src: string, selector: string) => {
  const at = src.indexOf(`${selector} {`)
  return at < 0 ? null : src.slice(at, src.indexOf('}', at))
}

describe('live audit contrast fixes', () => {
  it('names the Scout manager colour on the token instead of inheriting it', () => {
    expect(rule(css('components/core-app/af-scout.css'), '.af-core .af-sc-team')).toMatch(/color:\s*var\(--text\)/)
  })

  it('draws the Trades side labels and count labels in --muted, not --faint', () => {
    const trades = css('components/core-app/af-trades.css')
    expect(rule(trades, '.af-tr-count-label')).toMatch(/color:\s*var\(--muted\)/)
    expect(rule(trades, '.af-core .af-tr-side .af-label')).toMatch(/color:\s*var\(--muted\)/)
  })
})
