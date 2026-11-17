import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: true }) }))
vi.mock('@/hooks/useSubscriptionGate', () => ({ useSubscriptionGateOptional: () => null }))
vi.mock('@/components/subscription/PremiumGate', () => ({ PremiumGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/subscription/SubscriptionGateBadge', () => ({ SubscriptionGateBadge: () => <span data-testid="gate-badge" /> }))

import { LeagueSettingsPanel } from '@/app/league/[leagueId]/components/settings/LeagueSettingsPanel'

/**
 * "Minimum rounds held" was a keeper setting that saved a number nothing ever read: no keeper
 * submission, rollover or eligibility check used it, and no rule defined what it meant. The owner
 * chose to remove it (2026-11-17) rather than invent a meaning, so the settings page stops
 * promising a rule it does not apply. The column stays; only the control is gone.
 */
describe('keeper settings: no dead "Minimum rounds held" control', () => {
  it('a keeper league shows its real keeper rules and not the unread one', () => {
    const debouncedSave = vi.fn()
    render(
      <LeagueSettingsPanel
        leagueId="L1"
        initialData={{ leagueType: 'keeper', leagueSize: 10, keeperMinRoundsHeld: 3 } as never}
        hasAfCommissionerSub
        canEdit
        save={vi.fn(async () => undefined)}
        debouncedSave={debouncedSave}
      />,
    )
    // Positive control: the keeper section rendered, so an absence below means something.
    expect(screen.getByText('Max years per keeper')).toBeTruthy()
    expect(screen.getByText('Keeper cost system')).toBeTruthy()

    expect(screen.queryByText('Minimum rounds held')).toBeNull()
    expect(debouncedSave).not.toHaveBeenCalledWith(expect.objectContaining({ keeperMinRoundsHeld: expect.anything() }))
  })
})
