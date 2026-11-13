/**
 * League Home in /core, two visual gaps from the 2026-11-07 dynasty audit (both reach every format):
 *
 *  1. "This week → Moves": "Trades →" / "Waivers →" had no rule of their own — the grid's other cells are
 *     whole-card links styled by `> a > span:last-child` — so they rendered as 18px plain text.
 *  2. The imported-league strip (ImportedLeagueQuickActions) is shared with the always-dark LeagueShell and
 *     carries fixed dark Tailwind colours. On a light /core page it was a #0b1328 navy band whose text a
 *     light-mode rule had already turned dark: dark on dark. It now takes the theme's tokens inside
 *     `.af-core` only, through hook classes, so LeagueShell keeps its look.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'en', t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { ImportedLeagueQuickActions } from '@/components/league/ImportedLeagueQuickActions'

const css = readFileSync(path.join(process.cwd(), 'components/core-app/af-league-home.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))

/** The body of the TOP-LEVEL rule whose selector list starts the rule with `selector`. */
function topLevelRule(selector: string, src: string = css): string {
  const re = new RegExp(`(^|\\})(\\s*)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,{]`, 'g')
  for (const m of src.matchAll(re)) {
    const at = m.index! + m[1].length + m[2].length
    const before = src.slice(0, at)
    if (before.split('{').length - before.split('}').length !== 0) continue
    return src.slice(src.indexOf('{', at) + 1, src.indexOf('}', at))
  }
  throw new Error(`no top-level rule for ${selector}`)
}

describe('League Home: the Moves links', () => {
  it('look like the other cells\' links and are a 44px target', () => {
    const rule = topLevelRule('.af-lh-week-summary-moves > span:last-child a')
    expect(rule).toMatch(/color:\s*var\(--accent\)/)
    expect(rule).toMatch(/font-size:\s*12px/)
    expect(rule).toMatch(/min-height:\s*44px/)
  })
})

describe('League Home: the imported-league strip', () => {
  it('takes the theme inside /core, scoped so LeagueShell keeps its dark look', () => {
    expect(topLevelRule('.af-core .af-imported-actions')).toMatch(/background:\s*var\(--surface\)/)
    expect(topLevelRule('.af-core .af-imported-actions-text')).toMatch(/color:\s*var\(--text2\)/)
    expect(topLevelRule('.af-core .af-imported-actions-remove')).toMatch(/color:\s*var\(--bad\)/)
    // Never unscoped: a bare `.af-imported-actions` rule would repaint LeagueShell too.
    expect(() => topLevelRule('.af-imported-actions')).toThrow()
  })

  it('carries the hook classes those rules select', () => {
    const { container } = render(
      <ImportedLeagueQuickActions leagueId="L1" leagueName="The Deep!" platform="Sleeper" canRemove />,
    )
    const strip = container.querySelector('[data-testid=imported-league-quick-actions]')!
    expect(strip.classList.contains('af-imported-actions')).toBe(true)
    expect(strip.querySelector('p.af-imported-actions-text')).not.toBeNull()
    expect(container.querySelector('[data-testid=delete-imported-league-open]')?.classList.contains('af-imported-actions-remove')).toBe(true)
    // The shared dark defaults are still there for LeagueShell.
    expect(strip.className).toContain('bg-[#0b1328]')
  })

  // Control: the helper must refuse a rule nested in an at-rule or under a scope.
  it('the helper rejects a nested or scoped rule, and accepts a real top-level one', () => {
    expect(() => topLevelRule('.x', '@media (max-width: 1px) { .x { color: red } }')).toThrow()
    expect(() => topLevelRule('.x', '.af-core .x { color: red }')).toThrow()
    expect(topLevelRule('.x', '.a { color: blue } .x { color: red }')).toMatch(/color:\s*red/)
  })
})
