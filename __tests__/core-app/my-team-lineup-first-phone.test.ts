/**
 * My team on a phone: the lineup right after the fix (2026-11-07). Live at 375px STARTERS began 2,231px
 * down. On a narrow page the decision card, then Starters, Bench, IR and Taxi now come straight after the
 * countdown, ahead of the check strip, the matchup and "Best lineup" (measured 2,220 -> 1,428px).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
const css = read('components/core-app/af-my-team.css')
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('my team on a narrow page leads with the lineup', () => {
  it('moves the decision and every roster section up, in a top-level narrow-page query', () => {
    const start = code.lastIndexOf('@container af-mt (max-width: 500px) {')
    expect(start).toBeGreaterThan(-1)
    const before = code.slice(0, start)
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length)
    const block = code.slice(start)
    for (const sel of ['.af-mt-decision', '#af-mt-starters', '.af-mt-bench', '.af-mt-ir', '.af-mt-taxi']) {
      expect(block, sel).toContain(`.af-core .af-mt ${sel}`)
    }
    expect(block).toMatch(/\{\s*order: -1;\s*\}\s*\}\s*$/)
  })

  it('gives Bench, IR and Taxi the class names that rule targets', () => {
    const tsx = read('components/core-app/screens/MyTeam.tsx')
    expect(tsx).toContain('className="af-frame af-mt-section af-mt-bench"')
    expect(tsx).toContain('className="af-frame af-mt-section af-mt-ir"')
    expect(tsx).toContain('className="af-frame af-mt-section af-mt-taxi"')
    expect(tsx).toContain('<section id="af-mt-starters"')
    expect(tsx).toContain('className="af-frame af-mt-decision"')
  })

  it('records that the old "matchup above the starters" rule no longer holds on a narrow page', () => {
    expect(css).toContain('The matchup stays above the starters, EXCEPT on a narrow page')
  })
})
