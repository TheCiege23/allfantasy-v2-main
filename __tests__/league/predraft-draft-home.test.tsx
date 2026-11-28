/**
 * The one pre-draft Draft home, for every sport, size and draft type (owner, 2026-11-28: "simple like
 * Sleeper's screen"). It replaced the "Draft setup is ready" card and the post-create share popup.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PredraftDraftHome, type PredraftDraftHomeProps } from '@/components/league/draft-home/PredraftDraftHome'

function props(over: Partial<PredraftDraftHomeProps> = {}): PredraftDraftHomeProps {
  return {
    leagueId: 'L1',
    leagueName: 'MLB Redraft',
    sport: 'MLB',
    teamCount: 12,
    teams: [
      { id: 't1', teamName: 'Team Ciege', ownerName: 'TheCiege24', avatarUrl: null, draftPosition: 1, filled: true },
      { id: 't2', teamName: 'Team 2', ownerName: '', avatarUrl: null, draftPosition: 2, filled: false },
    ],
    draftTypeLabel: 'Snake',
    rounds: 24,
    timerSeconds: 90,
    draftDateIso: null,
    scoringLabel: 'Standard points',
    inviteUrl: 'https://x.test/join?code=ABC',
    isCommissioner: true,
    onOpenSettings: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ config: { slots: { C: 1, '1B': 1, OF: 3, SP: 2, BN: 5 } } }) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PredraftDraftHome', () => {
  it('shows the invite with the seat count, the draft facts, every seat, and the way in', async () => {
    render(<PredraftDraftHome {...props()} />)
    expect(screen.getByTestId('predraft-invite-count').textContent).toBe('1/12')
    expect(screen.getByText('Snake')).toBeTruthy()
    expect(screen.getByText('90 sec per pick')).toBeTruthy()
    expect(screen.getByText('24 rounds')).toBeTruthy()
    expect(screen.getAllByTestId('predraft-team-filled')).toHaveLength(1)
    expect(screen.getAllByTestId('predraft-team-open')).toHaveLength(11)
    expect(screen.getByText('Invite 11 more friends')).toBeTruthy()
    expect(screen.getByTestId('predraft-open-draft-room').getAttribute('href')).toBe('/league/L1/draft')
    expect(screen.getByTestId('predraft-start-mock-draft').getAttribute('href')).toBe('/mock-draft?leagueId=L1&sport=mlb')
    await waitFor(() => expect(screen.getByTestId('predraft-roster').textContent).toContain('OF ×3'))
  })

  it('no QR on screen until asked for', () => {
    render(<PredraftDraftHome {...props()} />)
    expect(screen.queryByTestId('predraft-invite-qr')).toBeNull()
    fireEvent.click(screen.getByTestId('predraft-invite-qr-toggle'))
    expect(screen.getByTestId('predraft-invite-qr')).toBeTruthy()
  })

  it('commissioner: set draft time and Edit open the right settings', () => {
    const onOpenSettings = vi.fn()
    render(<PredraftDraftHome {...props({ onOpenSettings })} />)
    fireEvent.click(screen.getByTestId('predraft-set-draft-time'))
    expect(onOpenSettings).toHaveBeenLastCalledWith('draft')
    fireEvent.click(screen.getByTestId('predraft-open-league-settings'))
    expect(onOpenSettings).toHaveBeenLastCalledWith(null)
  })

  it('a member sees no edit controls and, without an invite link, no invite block', () => {
    render(<PredraftDraftHome {...props({ isCommissioner: false, inviteUrl: '' })} />)
    expect(screen.queryByTestId('predraft-invite')).toBeNull()
    expect(screen.queryByTestId('predraft-set-draft-time')).toBeNull()
    expect(screen.queryByTestId('predraft-open-draft-settings')).toBeNull()
    expect(screen.queryByTestId('predraft-open-league-settings')).toBeNull()
  })

  it('hides the invite once every seat is filled, and reads the clock in minutes or as untimed', () => {
    const full = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, teamName: `T${i}`, ownerName: `o${i}`, avatarUrl: null, draftPosition: i + 1, filled: true }))
    const { rerender } = render(<PredraftDraftHome {...props({ teamCount: 4, teams: full, timerSeconds: 120 })} />)
    expect(screen.queryByTestId('predraft-invite')).toBeNull()
    expect(screen.getByText('Every seat is filled')).toBeTruthy()
    expect(screen.getByText('2 min per pick')).toBeTruthy()
    rerender(<PredraftDraftHome {...props({ teamCount: 4, teams: full, timerSeconds: 0 })} />)
    expect(screen.getByText('No pick clock')).toBeTruthy()
  })
})
