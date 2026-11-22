import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const ent = vi.hoisted(() => ({ hasCommissioner: false }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: ent.hasCommissioner }) }))
vi.mock('@/hooks/useSubscriptionGate', () => ({ useSubscriptionGateOptional: () => null }))
vi.mock('@/components/subscription/PremiumGate', () => ({ PremiumGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/subscription/SubscriptionGateBadge', () => ({ SubscriptionGateBadge: () => <span data-testid="gate-badge" /> }))

import { LeagueSettingsPanel } from '@/app/league/[leagueId]/components/settings/LeagueSettingsPanel'

function renderPanel(opts: { leagueSize: number; hasSub: boolean; settings?: Record<string, unknown> }) {
  ent.hasCommissioner = opts.hasSub
  const save = vi.fn(async () => undefined)
  render(
    <LeagueSettingsPanel
      leagueId="L1"
      initialData={{ leagueType: 'redraft', leagueSize: opts.leagueSize } as never}
      settingsSnapshot={opts.settings ?? {}}
      hasAfCommissionerSub={opts.hasSub}
      canEdit
      save={save}
      debouncedSave={vi.fn()}
    />,
  )
  return save
}

const toggleIn = (block: HTMLElement) => within(block).getAllByRole('switch')[0] ?? within(block).getAllByRole('checkbox')[0]

describe('the extra matchup setting', () => {
  it('only an odd league shows it', () => {
    renderPanel({ leagueSize: 8, hasSub: true })
    expect(screen.queryByTestId('settings-extra-matchup')).toBeNull()
  })

  it('without AF Commissioner it is shown locked, with the upgrade badge', () => {
    renderPanel({ leagueSize: 7, hasSub: false })
    const block = screen.getByTestId('settings-extra-matchup')
    expect(within(block).getByTestId('settings-extra-matchup-locked')).toBeTruthy()
    expect(toggleIn(block)).toBeDisabled()
  })

  it('a subscriber turns it on, and it saves through settingsMerge', () => {
    const save = renderPanel({ leagueSize: 7, hasSub: true })
    const block = screen.getByTestId('settings-extra-matchup')
    expect(within(block).queryByTestId('settings-extra-matchup-locked')).toBeNull()
    fireEvent.click(toggleIn(block)!)
    expect(save).toHaveBeenCalledWith({
      settingsMerge: { odd_team_extra_matchup: { enabled: true, opponent: 'top_scorer', scoring: 'leftover_only' } },
    })
  })

  it('a lapsed plan can still turn it off', () => {
    renderPanel({ leagueSize: 7, hasSub: false, settings: { odd_team_extra_matchup: { enabled: true } } })
    expect(toggleIn(screen.getByTestId('settings-extra-matchup'))).not.toBeDisabled()
  })
})
