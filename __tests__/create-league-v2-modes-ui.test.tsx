import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { CreateLeagueUnifiedForm } from '@/components/create-league-v2/CreateLeagueUnifiedForm'
import { CreateLeagueReviewStep } from '@/components/create-league-v2/CreateLeagueReviewStep'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}))

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'en' }),
  useLanguage: () => ({
    t: (key: string) => key,
    tInterpolate: (key: string) => key,
  }),
}))

vi.mock('@/lib/i18n/createLeagueWire', () => ({
  localizeDraftTypeOption: (_t: (key: string) => string, option: { id: string; label: string; hint: string }) => option,
}))

vi.mock('@/components/create-league', () => ({
  ConceptSelector: () => <section data-testid="concept-section">concept</section>,
  SportScoringSelector: () => <section data-testid="sport-scoring-section">sport-scoring</section>,
  TeamNameSection: () => <section data-testid="team-name-section">teams-name</section>,
  DraftTypeSelector: () => <section data-testid="draft-type-section">draft-type</section>,
  DynastyAdvancedSettings: () => <section data-testid="dynasty-advanced-section">dynasty-advanced</section>,
  KeeperAdvancedSettings: () => <section data-testid="keeper-advanced-section">keeper-advanced</section>,
  BestBallAdvancedSettings: () => <section data-testid="bestball-advanced-section">bestball-advanced</section>,
}))

vi.mock('@/components/create-league-v2/LeagueRegionalPreferencesCard', () => ({
  LeagueRegionalPreferencesCard: () => <section data-testid="regional-preferences-card">regional-preferences</section>,
}))

function state(overrides: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'dynasty',
    sport: 'NFL',
    scoringPresetId: 'fb_half_ppr',
    draftType: 'snake',
    name: 'Mode Test League',
    nameTouched: true,
    ...overrides,
  }
}

const accent = {
  name: 'cyan',
  hex: '#22d3ee',
  hexSoft: '#67e8f9',
  ring: 'ring-cyan-400/40',
  glow: 'shadow-[0_0_20px_-8px_rgba(34,211,238,0.8)]',
  text: 'text-cyan-300',
  border: 'border-cyan-400/30',
  from: 'from-cyan-400/20',
  to: 'to-cyan-200/10',
} as const

describe('create-league-v2 creation modes UI', () => {
  it('reviews the Zombie league count and total manager seats', () => {
    render(<CreateLeagueReviewStep state={state({ leagueType: 'zombie', teamCount: 20, zombieLeagueCount: 6 })} accent={accent} />)
    expect(screen.getByText('6 leagues · shared rules and settings')).toBeInTheDocument()
    expect(screen.getByText('20 managers per league · 120 roster seats in total')).toBeInTheDocument()
  })

  it('quick mode renders compact form and hides advanced sections', () => {
    render(
      <CreateLeagueUnifiedForm
        state={state({ creationMode: 'quick', leagueType: 'dynasty' })}
        accent={accent}
        onChange={() => undefined}
      />,
    )

    expect(screen.getByText('Quick Create')).toBeInTheDocument()
    expect(screen.getByTestId('quick-create-summary')).toBeInTheDocument()
    expect(screen.getByTestId('concept-section')).toBeInTheDocument()
    expect(screen.getByTestId('sport-scoring-section')).toBeInTheDocument()
    expect(screen.getByTestId('draft-type-section')).toBeInTheDocument()
    expect(screen.getByTestId('team-name-section')).toBeInTheDocument()

    expect(screen.queryByTestId('regional-preferences-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('advanced-review-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('regional-preferences-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dynasty-advanced-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('keeper-advanced-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bestball-advanced-section')).not.toBeInTheDocument()
  })

  it('advanced mode shows full commissioner setup sections', () => {
    render(
      <CreateLeagueUnifiedForm
        state={state({ creationMode: 'advanced', leagueType: 'dynasty' })}
        accent={accent}
        onChange={() => undefined}
      />,
    )

    expect(screen.getByTestId('advanced-create-heading')).toBeInTheDocument()
    expect(screen.getByTestId('regional-preferences-section')).toBeInTheDocument()
    expect(screen.getByTestId('regional-preferences-card')).toBeInTheDocument()
    expect(screen.getByTestId('advanced-review-section')).toBeInTheDocument()
    expect(screen.getByTestId('dynasty-advanced-section')).toBeInTheDocument()
  })

  it('quick mode can switch to advanced without resetting existing selections', () => {
    const onChange = vi.fn()
    const onSwitchToAdvanced = vi.fn()

    render(
      <CreateLeagueUnifiedForm
        state={state({ creationMode: 'quick', leagueType: 'dynasty', teamCount: 14, draftType: 'snake' })}
        accent={accent}
        onChange={onChange}
        onSwitchToAdvanced={onSwitchToAdvanced}
      />,
    )

    fireEvent.click(screen.getByTestId('switch-to-advanced'))
    expect(onChange).toHaveBeenCalledWith({ creationMode: 'advanced' })
    expect(onSwitchToAdvanced).toHaveBeenCalled()
  })

  it('quick mode supports redraft and dynasty concept selections', () => {
    const { rerender } = render(
      <CreateLeagueUnifiedForm
        state={state({ creationMode: 'quick', leagueType: 'redraft' })}
        accent={accent}
        onChange={() => undefined}
      />,
    )

    expect(screen.getByText('Quick Create')).toBeInTheDocument()

    rerender(
      <CreateLeagueUnifiedForm
        state={state({ creationMode: 'quick', leagueType: 'dynasty' })}
        accent={accent}
        onChange={() => undefined}
      />,
    )

    expect(screen.getByText('Quick Create')).toBeInTheDocument()
  })

  it('review labels quick and advanced modes and rank-window message', () => {
    const { rerender } = render(<CreateLeagueReviewStep state={state({ creationMode: 'quick' })} accent={accent} />)

    expect(screen.getByText('Creation mode')).toBeInTheDocument()
    expect(screen.getByText('Quick')).toBeInTheDocument()
    expect(screen.getByText('Rank window will be calculated after creation.')).toBeInTheDocument()

    rerender(<CreateLeagueReviewStep state={state({ creationMode: 'advanced' })} accent={accent} />)
    expect(screen.getByText('Advanced')).toBeInTheDocument()
  })
})
