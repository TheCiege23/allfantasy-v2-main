import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs script, no type declarations
import { BASELINE_PATH, DIRS, TERNARY, countTernaries, regressions } from '../../scripts/i18n-ternary-ratchet.mjs'

type Counts = Record<string, number>

describe('inline language ternary ratchet', () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Counts
  const current = countTernaries() as Counts

  it('no file under /core gained an inline language ternary', () => {
    // A new `language === 'es' ? … : …` belongs in a message catalog (lib/i18n/messages.ts).
    expect(regressions(current, baseline)).toEqual([])
  })

  it('GamePlan, the pilot screen, carries none', () => {
    expect(current['components/core-app/screens/GamePlan.tsx']).toBeUndefined()
  })

  it('scans the league pages too, and its pattern catches each ternary shape (positive control)', () => {
    expect(DIRS).toEqual(expect.arrayContaining(['components/core-app', 'lib/core-app', 'components/league', 'app/league']))
    const hits = (src: string) => (src.match(new RegExp(TERNARY.source, 'g')) ?? []).length
    expect(hits("const es = language === 'es'")).toBe(1)
    expect(hits("toLocaleDateString(lang === 'es' ? 'es' : 'en-US')")).toBe(1)
    expect(hits("{es ? 'Cancelar' : 'Cancel'}")).toBe(1)
    expect(hits("const s = spanish ? 'Sí' : 'Yes'")).toBe(1)
    expect(hits("const { t } = useOptionalLanguage()")).toBe(0)
  })

  it('the league pages carry none (migrated to the catalog 2026-10-31)', () => {
    expect(Object.keys(current).filter((f) => f.startsWith('components/league/') || f.startsWith('app/league/'))).toEqual([])
  })

  it('reports a file that rose, and a new file against a baseline of zero', () => {
    expect(regressions({ 'a.tsx': 3, 'b.tsx': 1, 'c.tsx': 2 }, { 'a.tsx': 2, 'c.tsx': 2 })).toEqual([
      { file: 'a.tsx', now: 3, baseline: 2 },
      { file: 'b.tsx', now: 1, baseline: 0 },
    ])
  })
})
