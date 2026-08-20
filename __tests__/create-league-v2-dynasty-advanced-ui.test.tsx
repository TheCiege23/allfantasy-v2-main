import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DynastyAdvancedSettings } from '@/components/create-league/DynastyAdvancedSettings'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}))

const accent = {
  label: 'Royal Violet',
  text: 'text-violet-300',
  hex: '#8B5CF6',
  hexSoft: '#4C1D95',
  ring: 'ring-violet-400/60',
  glow: 'shadow-[0_0_40px_-8px_rgba(139,92,246,0.55)]',
} as const

function dynastyState(overrides: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'dynasty',
    sport: 'NFL',
    scoringPresetId: 'fb_half_ppr_one_qb',
    draftType: 'snake',
    name: 'Dynasty UI Test',
    nameTouched: true,
    ...overrides,
  }
}

describe('Dynasty Advanced Options UI', () => {
  it('renders grouped cards with stable section test ids', () => {
    render(<DynastyAdvancedSettings state={dynastyState()} accent={accent} onChange={() => undefined} />)

    expect(screen.getByTestId('dynasty-advanced-section')).toBeInTheDocument()
    expect(screen.getByTestId('dynasty-group-basics')).toBeInTheDocument()
    expect(screen.getByTestId('dynasty-group-startup-draft')).toBeInTheDocument()
    expect(screen.getByTestId('dynasty-group-rookie-draft')).toBeInTheDocument()
    expect(screen.getByTestId('dynasty-group-roster-taxi')).toBeInTheDocument()
    expect(screen.getByTestId('dynasty-group-waivers-faab')).toBeInTheDocument()
    expect(screen.getByTestId('dynasty-group-trades-picks')).toBeInTheDocument()
    expect(screen.getByTestId('dynasty-group-ai-commissioner')).toBeInTheDocument()
  })

  it('does not surface technical template keys or intro URL fields in default layout', () => {
    render(<DynastyAdvancedSettings state={dynastyState()} accent={accent} onChange={() => undefined} />)

    expect(screen.queryByText(/roster template/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/scoring template/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/intro video url/i)).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(DEFAULT_V2_STATE.dynasty.rosterTemplateId)).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(DEFAULT_V2_STATE.dynasty.introVideoUrl)).not.toBeInTheDocument()
  })

  it('does not show paid/free league controls in the form', () => {
    render(<DynastyAdvancedSettings state={dynastyState()} accent={accent} onChange={() => undefined} />)

    expect(screen.queryByText(/^paid$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/monetization/i)).not.toBeInTheDocument()
  })

  it('preserves hidden dynasty defaults on state object', () => {
    const s = dynastyState()
    expect(s.dynasty.rosterTemplateId).toBeTruthy()
    expect(s.dynasty.scoringTemplateId).toBeTruthy()
    expect(s.dynasty.introVideoUrl).toMatch(/dynasty-intro/)
    expect(s.dynasty.monetization).toBe('free')
  })
})

describe('submit payload preserves hidden dynasty defaults', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, league: { id: 'x' }, homepageUrl: '/league/x' }),
      } as Response),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('still sends intro clip URL from default dynasty state', async () => {
    await submitCreateLeagueV2(dynastyState())

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const cs = body.conceptSetup as Record<string, unknown>
    expect(cs?.introVideoUrl).toBe(DEFAULT_V2_STATE.dynasty.introVideoUrl)
  })
})
