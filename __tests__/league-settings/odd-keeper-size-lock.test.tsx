import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const ent = vi.hoisted(() => ({ hasCommissioner: false }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: ent.hasCommissioner }) }))
vi.mock('@/hooks/useSubscriptionGate', () => ({ useSubscriptionGateOptional: () => null }))
vi.mock('@/components/subscription/PremiumGate', () => ({ PremiumGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/subscription/SubscriptionGateBadge', () => ({ SubscriptionGateBadge: () => <span data-testid="gate-badge" /> }))

import { LeagueSettingsPanel } from '@/app/league/[leagueId]/components/settings/LeagueSettingsPanel'

function renderPanel(leagueType: string, hasSub: boolean) {
  ent.hasCommissioner = hasSub
  return render(
    <LeagueSettingsPanel
      leagueId="L1"
      initialData={{ leagueType, leagueSize: 8 } as never}
      hasAfCommissionerSub={hasSub}
      canEdit
      save={vi.fn(async () => undefined)}
      debouncedSave={vi.fn()}
    />,
  )
}

function sizeSelect(): HTMLSelectElement {
  return screen.getByTestId('settings-league-size') as HTMLSelectElement
}

describe('league size in commissioner settings', () => {
  it('a keeper league without AF Commissioner sees odd sizes locked', () => {
    renderPanel('keeper', false)
    const options = [...sizeSelect().options]
    expect(options.find((o) => o.value === '7')!.disabled).toBe(true)
    expect(options.find((o) => o.value === '7')!.textContent).toContain('AF Commissioner')
    expect(options.find((o) => o.value === '10')!.disabled).toBe(false)
    expect(options.find((o) => o.value === '19')!.disabled).toBe(true)
    expect(options.find((o) => o.value === '20')!.disabled).toBe(false)
    expect(options.at(-1)!.value).toBe('20')
    expect(screen.getByTestId('settings-odd-keeper-size-locked')).toBeTruthy()
  })

  it('a subscriber, or a redraft league, can pick any size', () => {
    renderPanel('keeper', true)
    expect([...sizeSelect().options].every((o) => !o.disabled)).toBe(true)
    expect(screen.queryByTestId('settings-odd-keeper-size-locked')).toBeNull()
  })

  it('redraft odd sizes stay open without the plan, on the list as before (4–18)', () => {
    renderPanel('redraft', false)
    expect([...sizeSelect().options].every((o) => !o.disabled)).toBe(true)
    expect([...sizeSelect().options].at(-1)!.value).toBe('18')
  })
})
