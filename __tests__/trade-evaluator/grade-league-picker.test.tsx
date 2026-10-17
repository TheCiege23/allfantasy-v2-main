/**
 * The trade analyzer (/trade-evaluator) can choose the league its grade is taken in (2026-09-27).
 *
 * 🛑 Before this, the page only graded when opened with `?leagueId=` — /core's "Trade analyzer" tool
 * links a bare `/trade-evaluator`, so every trade from there came back "Not graded: no league".
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GradeLeaguePicker, gradeLeagueOptions, noLeagueGradeHint } from '@/components/trade-evaluator/GradeLeaguePicker'

describe('gradeLeagueOptions', () => {
  it('offers only unified NFL leagues, one per league, newest season, sorted by name', () => {
    const options = gradeLeagueOptions([
      { id: 'sl-1', name: 'Zeta Dynasty', sport: 'NFL', season: 2025, unifiedLeagueId: 'af-z', hasUnifiedRecord: true },
      { id: 'sl-2', name: 'Zeta Dynasty', sport: 'NFL', season: 2026, unifiedLeagueId: 'af-z', hasUnifiedRecord: true },
      { id: 'af-a', name: 'Alpha Redraft', sport: 'nfl', season: 2026, unifiedLeagueId: 'af-a', hasUnifiedRecord: true },
      // A Sleeper-space row: its id would 403 the evaluation's membership check.
      { id: 'sl-3', name: 'Legacy Only', sport: 'NFL', season: 2026, unifiedLeagueId: null, hasUnifiedRecord: false },
      // The analyzer prices NFL only.
      { id: 'af-n', name: 'Hoops', sport: 'NBA', season: 2026, unifiedLeagueId: 'af-n', hasUnifiedRecord: true },
    ])
    expect(options).toEqual([
      { id: 'af-a', label: 'Alpha Redraft · 2026' },
      { id: 'af-z', label: 'Zeta Dynasty · 2026' },
    ])
  })

  it('an empty list offers nothing', () => {
    expect(gradeLeagueOptions([])).toEqual([])
  })
})

describe('noLeagueGradeHint', () => {
  it('points at the picker when there is a league to pick, and at importing when there is none', () => {
    expect(noLeagueGradeHint(2)).toMatch(/Choose one of your leagues under League Settings/)
    expect(noLeagueGradeHint(0)).toMatch(/Import or join a league/)
  })
})

describe('GradeLeaguePicker', () => {
  it('lists "no league" first and reports the chosen league id', () => {
    const onChange = vi.fn()
    render(<GradeLeaguePicker options={[{ id: 'af-a', label: 'Alpha Redraft · 2026' }]} value="" onChange={onChange} />)
    const select = screen.getByTestId('trade-league-select') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['No league — the trade is not graded', 'Alpha Redraft · 2026'])
    fireEvent.change(select, { target: { value: 'af-a' } })
    expect(onChange).toHaveBeenCalledWith('af-a')
  })

  it('a linked league missing from the list still shows as chosen', () => {
    render(<GradeLeaguePicker options={[]} value="af-other" onChange={() => {}} />)
    expect((screen.getByTestId('trade-league-select') as HTMLSelectElement).value).toBe('af-other')
  })
})

describe('the /trade-evaluator page', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'app/trade-evaluator/page.tsx'), 'utf8')

  it('renders the picker and sends the chosen league with the evaluation', () => {
    expect(src).toMatch(/<GradeLeaguePicker options=\{gradeLeagues\} value=\{linkedLeagueId\} onChange=\{chooseGradeLeague\} \/>/)
    expect(src).toMatch(/\.\.\.\(linkedLeagueId \? \{ leagueId: linkedLeagueId \} : \{\}\)/)
  })

  it('reads the league list whether or not a league was linked in the URL', () => {
    // The old effect returned early without `?leagueId=`, which is what left the page league-less.
    expect(src).not.toMatch(/if \(!linkedLeagueIdParam\) return\s*\n\s*let cancelled/)
    expect(src).toMatch(/fetch\("\/api\/league\/list\?summary=1"\)/)
  })

  it('a grade taken in one league is dropped when another is chosen', () => {
    expect(src).toMatch(/setLinkedLeagueId\(leagueId\)\s*\n\s*setResult\(null\)/)
  })
})
