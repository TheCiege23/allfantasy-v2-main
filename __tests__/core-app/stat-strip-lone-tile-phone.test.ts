import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Waivers on a phone (2026-11-24, the simplify pass): a lone tile — usually "Waiver priority" in a league
 * without FAAB — is one row ("#11 · Waiver priority · of 12 rosters"), not a 100px box. It lives in the StatStrip
 * primitive, so every screen's lone value-first tile gets it; strips of two or more keep their grid.
 */
const css = readFileSync(join(process.cwd(), 'components/core-app/primitives/af-primitives.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('waivers lone tile on a phone', () => {
  it('lays a lone value-first tile out as one row in a narrow strip (the shared primitive, not the screen)', () => {
    const narrow = css.slice(css.indexOf('@container af-pg-stats (max-width: 599px)'))
    expect(narrow).toMatch(/\.af-pg-stats\[data-count='1'\]\[data-order='value-first'\] > \.af-pg-stat \{[^}]*grid-template-columns: auto minmax\(0, 1fr\)/)
    expect(narrow).toMatch(/> \.af-pg-stat > :first-child \{[^}]*grid-row: 1 \/ span 3/)
  })

  it('leaves strips of two or more tiles alone', () => {
    expect(css).not.toMatch(/data-count='2'\]\[data-order='value-first'\] > \.af-pg-stat \{[^}]*grid-template-columns: auto/)
  })
})
