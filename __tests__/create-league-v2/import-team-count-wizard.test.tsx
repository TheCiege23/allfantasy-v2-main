/**
 * The create wizard offers Dynasty (and the other import-flexible types) for an import whose team
 * count is off that type's native list, keeps the special modes hidden, and does not report the
 * imported count as an issue. A native create sees no change.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { createStateFromImportedLeague } from '@/lib/create-league-v2/import-template'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ testId, onSelect }: { testId: string; onSelect: () => void }) => <button data-testid={testId} onClick={onSelect}>Select</button>,
}))

import { LeagueBasicsStep } from '@/components/create-league-v2/CreateLeagueWizard'

describe('wizard league types for an imported team count', () => {
  it('shows Dynasty, Keeper and Best Ball for a 32-team NFL import', () => {
    const state = { ...DEFAULT_V2_STATE, leagueType: 'redraft' as const, teamCount: 32, sport: 'NFL' as const }
    render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} importCarryover />)
    expect(screen.getByTestId('g30-league-type-redraft')).toBeInTheDocument()
    expect(screen.getByTestId('g30-league-type-dynasty')).toBeInTheDocument()
    expect(screen.getByTestId('g30-league-type-keeper')).toBeInTheDocument()
    expect(screen.getByTestId('g30-league-type-best_ball')).toBeInTheDocument()
    // Special modes keep their own size lists.
    expect(screen.queryByTestId('g30-league-type-zombie')).toBeNull()
    expect(screen.queryByTestId('g30-league-type-salary_cap')).toBeNull()
  })

  it('control: Zombie and Salary Cap do appear for a 12-team import', () => {
    const state = { ...DEFAULT_V2_STATE, leagueType: 'redraft' as const, teamCount: 12, sport: 'NFL' as const }
    render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} importCarryover />)
    expect(screen.getByTestId('g30-league-type-zombie')).toBeInTheDocument()
    expect(screen.getByTestId('g30-league-type-salary_cap')).toBeInTheDocument()
  })

  it('a native create still offers only the listed sizes', () => {
    const state = { ...DEFAULT_V2_STATE, leagueType: 'dynasty' as const, teamCount: 16, sport: 'NFL' as const }
    render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    // 16 is the top of the native dynasty list, so there is nothing larger to step to.
    expect(screen.getByTestId('g30-team-count-increase')).toBeDisabled()
  })
})

describe('import template and completion for an off-list team count', () => {
  it('keeps a 32-team dynasty import as dynasty with all 32 teams', () => {
    const template = createStateFromImportedLeague({
      name: 'Big League', sport: 'NFL', leagueType: 'dynasty', leagueVariant: null,
      leagueSize: 32, scoringPresetId: null, draftType: 'snake',
    })
    expect(template.leagueType).toBe('dynasty')
    expect(template.teamCount).toBe(32)
  })

  it('does not flag the imported count, and still flags it for a native create', () => {
    const state = { ...DEFAULT_V2_STATE, leagueType: 'dynasty' as const, teamCount: 9, sport: 'NFL' as const }
    const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code)
    expect(codes(analyzeCreateLeagueCompletion(state))).toContain('team_count_invalid')
    expect(codes(analyzeCreateLeagueCompletion(state, { importedTeamCount: 9 }))).not.toContain('team_count_invalid')
  })
})
