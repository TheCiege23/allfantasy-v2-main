import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CommissionerControlCenterModal } from '@/components/app/draft-room/CommissionerControlCenterModal'

/**
 * Chimmy AI managers in the commissioner panel. A ticked team now drafts on its own a few seconds
 * after it comes on the clock, so a tick has to mean the commissioner chose it: unassigned open
 * teams start unticked (they defaulted to ticked, so saving the panel for any reason assigned every
 * orphan). Rows name the team instead of showing a roster id.
 */

function renderPanel(onSave = vi.fn().mockResolvedValue({ ok: true })) {
  render(
    <CommissionerControlCenterModal
      leagueId="league-1"
      draftStatus="in_progress"
      draftType="snake"
      draftUISettings={{ timerMode: 'per_pick', orphanTeamAiManagerEnabled: true } as any}
      timerSeconds={90}
      orphanStatus={{ orphanRosterIds: ['r-open-a', 'r-open-b'], recentActions: [] }}
      commissionerAiDraft={{
        assignedAiTeams: [{ teamId: 'r-open-b', teamName: 'Team B', aiStyle: 'BPA', tradeAggression: 'none', active: true }],
        tradeRules: {
          allowOutbound: true,
          allowInbound: true,
          blockAiToAi: true,
          proposalCooldownSeconds: 90,
          maxProposalsPerRound: 4,
          acceptConfidenceMin: 0.58,
        },
      }}
      teamNameByRosterId={{ 'r-open-a': 'Open Team A (slot 3)', 'r-open-b': 'Team B (slot 9)' }}
      onSaveCommissionerAiDraft={onSave}
      onClose={vi.fn()}
      onAction={vi.fn().mockResolvedValue({ ok: true })}
      onSettingsPatch={vi.fn().mockResolvedValue(undefined)}
      onResync={vi.fn()}
    />,
  )
  return onSave
}

function checkboxFor(rosterId: string): HTMLInputElement {
  const label = screen.getByTestId(`draft-commissioner-ai-team-${rosterId}`).closest('label')
  return label!.querySelector('input[type="checkbox"]') as HTMLInputElement
}

describe('Chimmy AI managers panel', () => {
  it('is labelled as Chimmy and names teams', () => {
    renderPanel()
    expect(screen.getByText(/Chimmy AI managers/)).toBeTruthy()
    expect(screen.getByTestId('draft-commissioner-ai-team-r-open-a').textContent).toBe('Open Team A (slot 3)')
    expect(screen.getByTestId('draft-commissioner-ai-team-r-open-b').textContent).toBe('Team B (slot 9)')
  })

  it('starts unassigned teams unticked and keeps existing assignments ticked', () => {
    renderPanel()
    expect(checkboxFor('r-open-a').checked).toBe(false)
    expect(checkboxFor('r-open-b').checked).toBe(true)
  })

  it('saves only the teams the commissioner ticked as active', async () => {
    const onSave = renderPanel()
    await act(async () => {
      fireEvent.click(screen.getByTestId('draft-commissioner-ai-managers-save'))
    })
    const saved = onSave.mock.calls[0]![0] as { assignedAiTeams: Array<{ teamId: string; active: boolean }> }
    expect(saved.assignedAiTeams).toEqual([
      expect.objectContaining({ teamId: 'r-open-a', active: false }),
      expect.objectContaining({ teamId: 'r-open-b', active: true }),
    ])
  })
})
