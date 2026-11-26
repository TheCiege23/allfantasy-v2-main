/**
 * Guilly Chimmy on the Guillotine hub (2026-11-24, the simplify pass): a closed row whose heading is the
 * summary. Open, its five plan chips and button were ~400px of the hub on every visit.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/hooks/useAfSubGate', () => ({ useAfSubGate: () => ({ handleApiResponse: async () => true }) }))
vi.mock('@/components/subscription/FeatureGate', () => ({ FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

import { GuillotineAIPanel } from '@/components/guillotine/GuillotineAIPanel'

afterEach(cleanup)

describe('Guilly Chimmy panel', () => {
  it('is a closed row, its heading the summary, with the plan chips inside', () => {
    render(<GuillotineAIPanel leagueId="league-1" deterministicSummary={{ survivalStandings: [], dangerTiers: [], choppedThisWeek: [], recentChopEvents: [] } as never} />)
    const ai = screen.getByTestId('guillotine-ai-panel')
    expect(ai.tagName).toBe('DETAILS')
    expect((ai as HTMLDetailsElement).open).toBe(false)
    expect(ai.querySelector('summary h2')?.textContent).toContain('Guilly Chimmy')
    expect(ai.textContent).toContain('Ask Chimmy for a plan to stay above the cut')
  })
})
