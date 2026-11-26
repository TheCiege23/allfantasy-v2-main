/**
 * 🛑 ON A PHONE THE WAIVERS FILTER BAR'S LABELS RAN INTO EACH OTHER (2026-11-25, measured at 375px on
 * production): the phone rule gave every `.nls-seg` button `flex: 1` (1 1 0%), so a 7-item bar squeezed each
 * button to 46px while "Available", "Watchlist" and "My claims" need 69–74px, and the nowrap labels overlapped.
 * The buttons may grow to fill the bar but must never shrink below their label; a bar that cannot fit scrolls.
 * jsdom does no layout, so this pins the rule.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.join(process.cwd(), 'components/league/native/screens/native-screens.css'), 'utf8')

describe('segmented control on a phone', () => {
  it('🛑 a button never shrinks below its label', () => {
    const rules = [...css.matchAll(/^\s*\.nls-seg button \{([^}]*)\}/gm)].map((m) => m[1]!)
    const withFlex = rules.filter((r) => /\bflex:/.test(r))
    expect(withFlex.length).toBeGreaterThan(0)
    for (const r of withFlex) {
      const flex = /\bflex:\s*([^;]+);?/.exec(r)![1]!.trim()
      // `flex: 1` / `1 1 0%` shrinks; the shrink factor must be 0.
      expect(flex, `.nls-seg button { flex: ${flex} }`).toMatch(/^\d+ 0 auto$/)
    }
  })
  it('the bar scrolls sideways when its buttons do not fit', () => {
    expect(css).toMatch(/\.nls-seg \{ width: 100%; overflow-x: auto;/)
  })
})
