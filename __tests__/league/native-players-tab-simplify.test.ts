import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Native Player search (2026-11-24, the simplify pass). Read from source, comments stripped, so a check
 * cannot match the comment that explains a removal.
 */
const src = readFileSync(join(process.cwd(), 'app/league/[leagueId]/tabs/PlayersTab.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('native Player search tab', () => {
  it('folds Start A vs B into a closed row', () => {
    expect(src).toMatch(/<details className="rdp-compare[^"]*" data-testid="players-tab-compare">\s*<summary[^>]*>Start A vs B<\/summary>/)
  })

  it('says what the list is once, without naming the data pipeline', () => {
    expect(src).not.toContain('normalized redraft player foundation')
    expect(src).not.toContain('league player feed when available')
  })

  it('has no button without a handler (the old Advanced filters icon)', () => {
    expect(src).not.toContain('players-tab-advanced-filters')
  })

  it('keeps the filter bar out of the way on a phone: sticky from md up, chips in one sideways row', () => {
    expect(src).toMatch(/className="rdp-bar z-10 space-y-3 md:sticky md:top-0/)
    expect(src).toMatch(/flex flex-nowrap gap-1\.5 overflow-x-auto sm:flex-wrap[^"]*" data-testid="players-tab-waiver-subnav"/)
    expect(src).toMatch(/flex flex-nowrap gap-1\.5 overflow-x-auto sm:flex-wrap[^"]*" data-testid="players-tab-positions"/)
  })
})
