/**
 * The Create wizard offers Guillotine again — for the sports the catalog allows it — and never
 * shows a median-game box for it (a guillotine week has no head-to-head game to double).
 *
 * The G30 simplification (July) cut the concept tiles to four; a native guillotine league has
 * played a full season since, so the tile was the only missing piece.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { LeagueBasicsStep } from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (key: string) => key, tInterpolate: (key: string) => key }),
}))

function state(overrides: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'redraft',
    sport: 'NFL',
    scoringPresetId: 'fb_half_ppr',
    draftType: 'snake',
    name: 'Guillotine Tile League',
    nameTouched: true,
    ...overrides,
  }
}

describe('Create wizard — Guillotine tile', () => {
  it('offers Guillotine for NFL, and picking it sets the concept', () => {
    const onChange = vi.fn()
    render(<LeagueBasicsStep state={state()} onChange={onChange} fieldErrors={{}} />)
    fireEvent.click(screen.getByTestId('g30-league-type-guillotine'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ leagueType: 'guillotine' }))
  })

  it('does not offer Guillotine for a sport the server refuses it for (NCAAB)', () => {
    render(<LeagueBasicsStep state={state({ sport: 'NCAAB', scoringPresetId: '' })} onChange={vi.fn()} fieldErrors={{}} />)
    expect(screen.queryByTestId('g30-league-type-guillotine')).toBeNull()
    expect(screen.getByTestId('g30-league-type-redraft')).toBeTruthy()
  })

  it('hides the median-game box for guillotine, and shows it for redraft', () => {
    const { rerender } = render(<LeagueBasicsStep state={state({ leagueType: 'guillotine' })} onChange={vi.fn()} fieldErrors={{}} />)
    expect(screen.queryByTestId('g30-median-game')).toBeNull()
    rerender(<LeagueBasicsStep state={state({ leagueType: 'redraft' })} onChange={vi.fn()} fieldErrors={{}} />)
    expect(screen.getByTestId('g30-median-game')).toBeTruthy()
  })
})
