/**
 * Team counts in the create wizard. The import-copy path that let a league keep an off-list size is
 * retired (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §10), so every create sees the
 * format's own list. A template built from an imported league still keeps that league's size.
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

describe('wizard team counts', () => {
  it('a native create still offers only the listed sizes', () => {
    const state = { ...DEFAULT_V2_STATE, leagueType: 'dynasty' as const, teamCount: 250, sport: 'NFL' as const }
    render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    // 250 is the largest dynasty size.
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

  it('flags an off-list count', () => {
    // Best ball is still list-bound (even sizes 4–16); dynasty now takes every size from 4 to 250.
    const state = { ...DEFAULT_V2_STATE, leagueType: 'best_ball' as const, teamCount: 9, sport: 'NFL' as const }
    const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code)
    expect(codes(analyzeCreateLeagueCompletion(state))).toContain('team_count_invalid')
  })
})
