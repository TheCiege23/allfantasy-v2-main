import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DynastyAdvancedSettings } from '@/components/create-league/DynastyAdvancedSettings'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'

describe('dynasty creation draft choices', () => {
  it('updates the actual startup draft and labels the future order as weighted', () => {
    const onChange = vi.fn()
    render(<DynastyAdvancedSettings state={{ ...DEFAULT_V2_STATE, leagueType: 'dynasty' }} accent="cyan" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Startup draft type'), { target: { value: 'auction' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ draftType: 'auction', dynasty: expect.objectContaining({ startupDraftType: 'auction' }) }))
    fireEvent.change(screen.getByLabelText('Rookie order method'), { target: { value: 'weighted_lottery' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ dynasty: expect.objectContaining({ rookieDraftOrderMethod: 'weighted_lottery' }) }))
    expect(screen.getByRole('option', { name: 'Weighted lottery (future rookie drafts)' })).toBeTruthy()
  })
})
